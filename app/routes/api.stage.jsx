import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const ALLOWED_EXTENSIONS = [
  ".pdf", ".zip", ".mp3", ".mp4", ".png", ".jpg", ".jpeg",
  ".gif", ".webp", ".mov", ".epub", ".docx", ".xlsx",
];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

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
        return Response.json({ error: `"${f.filename}" exceeds 100MB limit.` }, { status: 400 });
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

    const saved = [];

    for (const f of files) {
      // Register with Shopify Files API to get a permanent CDN URL
      let fileUrl = f.resourceUrl; // fallback if fileCreate fails or times out
      try {
        const fcRes = await admin.graphql(
          `#graphql
          mutation fileCreate($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
              files {
                id
                fileStatus
                ... on GenericFile { url }
              }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              files: [{
                alt: f.displayName || f.filename,
                contentType: "FILE",
                originalSource: f.resourceUrl,
              }],
            },
          }
        );
        const fcData = await fcRes.json();
        const created = fcData.data?.fileCreate;
        const shopifyFileId = created?.files?.[0]?.id;

        if (!created?.userErrors?.length && shopifyFileId) {
          // fileCreate is async — poll until file is READY (max ~9s)
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise((r) => setTimeout(r, attempt === 0 ? 500 : 1500));
            const pollRes = await admin.graphql(
              `#graphql
              query PollFile($id: ID!) {
                node(id: $id) {
                  ... on GenericFile { fileStatus url }
                }
              }`,
              { variables: { id: shopifyFileId } }
            );
            const pollData = await pollRes.json();
            const pollFile = pollData.data?.node;
            if (pollFile?.url) {
              fileUrl = pollFile.url;
              break;
            }
          }
        }
      } catch {
        // fileCreate failed — use resourceUrl as fallback
      }

      const record = await prisma.productFile.create({
        data: {
          shop: session.shop,
          productId,
          productTitle: productTitle || "",
          fileName: f.filename,
          fileUrl,
          mimeType: f.mimeType || "application/octet-stream",
          fileSize: f.fileSize || 0,
          displayName: f.displayName || f.filename,
          downloadEnabled: downloadEnabled !== false,
        },
      });

      saved.push({ fileId: record.id, fileName: f.filename });
    }

    // Fire-and-forget metafield update — don't block the response.
    prisma.productFile.findMany({ where: { shop: session.shop, productId }, orderBy: { createdAt: "desc" } })
      .then((allProductFiles) => {
        const value = JSON.stringify(allProductFiles.map((f) => ({ fileId: f.id, displayName: f.displayName || f.fileName, fileUrl: f.fileUrl })));
        return admin.graphql(
          `mutation SetFilesMetafield($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }`,
          { variables: { metafields: [{ ownerId: productId, namespace: "pendora", key: "files", type: "json", value }] } }
        );
      })
      .catch((err) => console.error("[Pendora] Metafield write failed:", err?.message ?? err));

    return Response.json({ saved });
  }

  return Response.json({ error: "Unknown intent." }, { status: 400 });
};
