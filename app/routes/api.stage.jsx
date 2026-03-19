import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const ALLOWED_EXTENSIONS = [
  ".pdf", ".zip", ".mp3", ".mp4", ".png", ".jpg", ".jpeg",
  ".gif", ".webp", ".mov", ".epub", ".docx", ".xlsx",
];
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

/**
 * Two-phase upload endpoint — JSON only, no binary data, no tunnel issues.
 *
 * Phase 1 (intent: "stage"):
 *   Receive file metadata → call Shopify stagedUploadsCreate → return presigned URLs
 *   Client then uploads files DIRECTLY to Shopify CDN (browser → CDN, bypasses tunnel)
 *
 * Phase 2 (intent: "save"):
 *   Receive CDN resourceUrls → call fileCreate → save DB records
 */
export const action = async ({ request }) => {
  // Auth — JSON body is tiny, no stream issues
  let admin, session;
  try {
    ({ admin, session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) {
      return Response.json({ error: "Authentication failed. Please refresh the page." }, { status: 401 });
    }
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { intent } = body || {};

  // ── Phase 1: Get presigned upload targets ────────────────────────────────
  if (intent === "stage") {
    const { files } = body;
    if (!files?.length) return Response.json({ error: "No files specified." }, { status: 400 });

    for (const f of files) {
      const ext = "." + f.filename.split(".").pop().toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return Response.json({ error: `"${f.filename}" — file type not allowed.` }, { status: 400 });
      }
      if (f.fileSize > MAX_FILE_SIZE) {
        return Response.json({ error: `"${f.filename}" exceeds 5GB limit.` }, { status: 400 });
      }
    }

    let result;
    try {
      const res = await admin.graphql(
        `#graphql
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            input: files.map((f) => ({
              filename: f.filename,
              mimeType: f.mimeType || "application/octet-stream",
              resource: "FILE",
              fileSize: String(f.fileSize),
              httpMethod: "PUT",
            })),
          },
        }
      );
      const data = await res.json();
      result = data.data.stagedUploadsCreate;
    } catch (err) {
      return Response.json({ error: "Failed to prepare upload: " + err.message }, { status: 500 });
    }

    if (result.userErrors?.length) {
      return Response.json({ error: result.userErrors[0].message }, { status: 400 });
    }

    return Response.json({ targets: result.stagedTargets });
  }

  // ── Phase 2: Register files + save DB records ────────────────────────────
  if (intent === "save") {
    const { files, productId, productTitle, downloadEnabled } = body;
    if (!files?.length) return Response.json({ error: "No files to save." }, { status: 400 });
    if (!productId) return Response.json({ error: "No product specified." }, { status: 400 });

    // Save all records in one transaction — single DB commit, no sequential round-trips.
    let records;
    try {
      records = await prisma.$transaction(
        files.map((f) =>
          prisma.productFile.create({
            data: {
              shop: session.shop,
              productId,
              productTitle: productTitle || "",
              fileName: f.filename,
              fileUrl: f.resourceUrl,
              mimeType: f.mimeType || "application/octet-stream",
              fileSize: f.fileSize != null ? BigInt(f.fileSize) : null,
              displayName: f.displayName || f.filename,
              downloadEnabled: downloadEnabled !== false,
            },
          })
        )
      );
    } catch (err) {
      return Response.json({ error: "Failed to save files: " + err.message }, { status: 500 });
    }

    const saved = records.map((r, i) => ({ fileId: r.id, fileName: files[i].filename }));
    const _shop = session.shop;

    // Background: register all files with Shopify in ONE mutation, poll CDN URLs in
    // parallel, then write the metafield exactly once when all polling is done.
    ;(async () => {
      try {
        // Register all files with Shopify Files API in a single mutation call.
        const fcRes = await admin.graphql(
          `#graphql
          mutation fileCreate($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
              files { id fileStatus ... on GenericFile { url } }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              files: files.map((f) => ({
                alt: f.displayName || f.filename,
                contentType: "FILE",
                originalSource: f.resourceUrl,
              })),
            },
          }
        );
        const fcData = await fcRes.json();
        const shopifyFiles = fcData.data?.fileCreate?.files ?? [];
        if (fcData.data?.fileCreate?.userErrors?.length || shopifyFiles.length === 0) return;

        // Poll all files in parallel — each finds its CDN URL independently.
        // No DB reads inside the poll loop — just write when URL arrives.
        await Promise.all(
          shopifyFiles.map(async (sf, i) => {
            const record = records[i];
            if (!sf?.id) return;
            for (let attempt = 0; attempt < 30; attempt++) {
              await new Promise((r) => setTimeout(r, 2000));
              const pollRes = await admin.graphql(
                `#graphql query PollFile($id: ID!) { node(id: $id) { ... on GenericFile { fileStatus url } } }`,
                { variables: { id: sf.id } }
              );
              const cdnUrl = (await pollRes.json()).data?.node?.url;
              if (cdnUrl) {
                await prisma.productFile.update({ where: { id: record.id }, data: { fileUrl: cdnUrl } });
                break;
              }
            }
          })
        );

        // One single metafield update after all polling is done.
        const allFiles = await prisma.productFile.findMany({
          where: { shop: _shop, productId },
          orderBy: { createdAt: "desc" },
        });
        const value = JSON.stringify(
          allFiles.map((af) => ({ fileId: af.id, displayName: af.displayName || af.fileName, fileUrl: af.fileUrl }))
        );
        await admin.graphql(
          `mutation SetFilesMetafield($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`,
          { variables: { m: [{ ownerId: productId, namespace: "pendora", key: "files", type: "json", value }] } }
        );
      } catch (err) {
        console.error("[Pendora] Background CDN update failed:", err?.message ?? err);
      }
    })();

    return Response.json({ saved });
  }

  return Response.json({ error: "Unknown intent." }, { status: 400 });
};
