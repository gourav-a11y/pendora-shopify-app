import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncProductFilesMetafield, buildFilesPayload } from "../utils/metafield.server";

const ALLOWED_EXTENSIONS = [
  ".pdf", ".zip", ".mp3", ".mp4", ".png", ".jpg", ".jpeg",
  ".gif", ".webp", ".mov", ".epub", ".docx", ".xlsx",
];
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

// Acceptable MIME types — anything outside this list gets replaced with application/octet-stream
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/zip", "application/x-zip-compressed",
  "audio/mpeg", "audio/mp3",
  "video/mp4", "video/quicktime",
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "application/epub+zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

function sanitizeMimeType(mimeType) {
  const mt = (mimeType || "").toLowerCase().trim();
  return ALLOWED_MIME_TYPES.has(mt) ? mt : "application/octet-stream";
}

/** Accept undefined/null/"" as "no cap"; otherwise require a positive int. */
function normalizeLimit(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

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
      const fname = (f.filename || "").trim();
      if (!fname) return Response.json({ error: "Invalid filename." }, { status: 400 });
      const lastDot = fname.lastIndexOf(".");
      if (lastDot <= 0) return Response.json({ error: `"${fname}" — must have a valid file extension.` }, { status: 400 });
      const ext = fname.substring(lastDot).toLowerCase().trim();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return Response.json({ error: `"${fname}" — file type not allowed.` }, { status: 400 });
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
              mimeType: sanitizeMimeType(f.mimeType),
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
    const { files, productId, productTitle, downloadEnabled, maxDownloadsPerOrder } = body;
    if (!files?.length) return Response.json({ error: "No files to save." }, { status: 400 });
    if (!productId) return Response.json({ error: "No product specified." }, { status: 400 });

    // Normalize the optional limit: accept undefined / null / "" as "no limit";
    // anything else must be a positive integer.
    const normalizedLimit = normalizeLimit(maxDownloadsPerOrder);

    // Save all records in one transaction — single DB commit, no sequential round-trips.
    // Chunked files: fileUrl = null, chunkUrls = JSON array of resourceUrls.
    // Single files:  fileUrl = resourceUrl, chunkUrls = null (same as before).
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
              fileUrl: f.chunkUrls?.length ? null : (f.resourceUrl || null),
              chunkUrls: f.chunkUrls?.length ? JSON.stringify(f.chunkUrls) : null,
              mimeType: sanitizeMimeType(f.mimeType),
              fileSize: f.fileSize != null ? BigInt(f.fileSize) : null,
              displayName: f.displayName || f.filename,
              downloadEnabled: downloadEnabled !== false,
              maxDownloadsPerOrder: normalizedLimit,
              status: "pending",
            },
          })
        )
      );
    } catch (err) {
      return Response.json({ error: "Failed to save files: " + err.message }, { status: 500 });
    }

    const saved = records.map((r, i) => ({ fileId: r.id, fileName: files[i].filename }));
    const _shop = session.shop;

    // Background: register all resourceUrls with Shopify Files API, poll CDN URLs,
    // update DB, then sync metafield once.
    // Top-level .catch on the IIFE guards against throws inside the outer catch block itself.
    ;(async () => {
      try {
        // Flatten: single files = 1 item, chunked files = N items (one per chunk).
        const itemsToRegister = [];
        for (let fi = 0; fi < files.length; fi++) {
          const f = files[fi];
          const record = records[fi];
          if (f.chunkUrls?.length) {
            for (let ci = 0; ci < f.chunkUrls.length; ci++) {
              itemsToRegister.push({ resourceUrl: f.chunkUrls[ci], isChunk: true, chunkIndex: ci, fileIndex: fi, record });
            }
          } else if (f.resourceUrl) {
            itemsToRegister.push({ resourceUrl: f.resourceUrl, isChunk: false, fileIndex: fi, record });
          }
        }
        if (!itemsToRegister.length) return;

        // Register with Shopify Files API — batch in groups of 20.
        const FC_BATCH = 20;
        const shopifyFiles = [];
        for (let b = 0; b < itemsToRegister.length; b += FC_BATCH) {
          const batch = itemsToRegister.slice(b, b + FC_BATCH);
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
                files: batch.map((item) => ({
                  alt: item.isChunk
                    ? `${files[item.fileIndex].displayName || files[item.fileIndex].filename}_chunk_${item.chunkIndex}`
                    : (files[item.fileIndex].displayName || files[item.fileIndex].filename),
                  contentType: "FILE",
                  originalSource: item.resourceUrl,
                })),
              },
            }
          );
          const fcData = await fcRes.json();
          shopifyFiles.push(...(fcData.data?.fileCreate?.files ?? []));
        }
        if (!shopifyFiles.length) return;

        // Poll all in parallel — get final CDN URL for each. Returns null (not the
        // staged URL!) if polling fails; downstream marks that file as failed so
        // we never persist a stale shopify-staged-uploads URL that expires in 24h.
        // Budget: 60 attempts × 3s = 3 minutes per file, plus early exit on FAILED.
        const finalUrls = await Promise.all(
          shopifyFiles.map(async (sf) => {
            if (!sf?.id) return null;
            for (let attempt = 0; attempt < 60; attempt++) {
              await new Promise((r) => setTimeout(r, 3000));
              const pollRes = await admin.graphql(
                `#graphql query PollFile($id: ID!) { node(id: $id) { ... on GenericFile { fileStatus url } } }`,
                { variables: { id: sf.id } }
              );
              const node = (await pollRes.json()).data?.node;
              if (node?.url) return node.url;
              // Abort early on FAILED status — Shopify won't produce a URL.
              if (node?.fileStatus === "FAILED") {
                console.error(`[Pendora] Shopify reported FAILED for file ${sf.id}`);
                return null;
              }
            }
            console.error(`[Pendora] Polling timed out (3 min) for file ${sf.id}; marking as failed.`);
            return null;
          })
        );

        // Write final URLs back to DB — one update per original file record.
        // H2: if any chunk URL is missing (polling failed + fallback also null),
        // mark the file as failed instead of persisting a corrupt chunk array.
        for (let fi = 0; fi < files.length; fi++) {
          const f = files[fi];
          const record = records[fi];
          if (f.chunkUrls?.length) {
            const finalChunkUrls = itemsToRegister
              .filter((item) => item.fileIndex === fi)
              .sort((a, b) => a.chunkIndex - b.chunkIndex)
              .map((item) => finalUrls[itemsToRegister.indexOf(item)]);
            if (finalChunkUrls.some((u) => !u)) {
              console.error(`[Pendora] Chunk URL missing for record ${record.id}; marking failed.`);
              await prisma.productFile.update({ where: { id: record.id }, data: { status: "failed" } });
            } else {
              await prisma.productFile.update({ where: { id: record.id }, data: { chunkUrls: JSON.stringify(finalChunkUrls), status: "ready" } });
            }
          } else {
            const idx = itemsToRegister.findIndex((item) => item.fileIndex === fi);
            if (idx >= 0 && finalUrls[idx]) {
              await prisma.productFile.update({ where: { id: record.id }, data: { fileUrl: finalUrls[idx], status: "ready" } });
            } else {
              console.error(`[Pendora] CDN URL missing for record ${record.id}; marking failed.`);
              await prisma.productFile.update({ where: { id: record.id }, data: { status: "failed" } });
            }
          }
        }

        // One single metafield update after all polling is done.
        const allFiles = await prisma.productFile.findMany({
          where: { shop: _shop, productId },
          orderBy: { createdAt: "desc" },
        });
        await syncProductFilesMetafield(admin, productId, buildFilesPayload(allFiles));
      } catch (err) {
        console.error("[Pendora] Background CDN update failed:", err?.message ?? err);
        // Mark all records from this batch as failed
        for (const record of records) {
          try { await prisma.productFile.update({ where: { id: record.id }, data: { status: "failed" } }); } catch {}
        }
      }
    })().catch((err) => console.error("[Pendora] Background task top-level error:", err?.message ?? err));

    return Response.json({ saved });
  }

  return Response.json({ error: "Unknown intent." }, { status: 400 });
};
