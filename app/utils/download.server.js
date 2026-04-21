import prisma from "../db.server";

/**
 * Shared download pipeline for both the legacy /api/download/:fileId route and
 * the new tokenized /api/dl/:token route. Assumes the caller has already verified
 * the Shopify App Proxy HMAC and resolved fileId + orderId.
 *
 * Returns a Response. Success = 200 streaming the file bytes. Non-success =
 * short text body with the appropriate status (404 / 403 / 500 / 502).
 */

async function fetchWithRetry(url, attempts = 3, delayMs = 500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw lastErr ?? new Error("Fetch failed");
}

function isValidCdnUrl(urlStr) {
  try {
    const h = new URL(urlStr).hostname;
    return h.endsWith(".shopifycdn.com") || h.endsWith(".shopify.com") || h.endsWith(".googleapis.com");
  } catch { return false; }
}

// Fire-and-forget counter increment. Never throws, never blocks the download.
function incrementDownloadCount({ shop, fileId, orderId }) {
  if (!orderId) return;
  Promise.resolve()
    .then(() =>
      prisma.fileOrderDownload.upsert({
        where: { fileId_orderId: { fileId, orderId } },
        create: { shop, fileId, orderId, count: 1 },
        update: { count: { increment: 1 } },
      }),
    )
    .catch((err) => console.error("[Pendora] Download counter upsert failed:", err?.message ?? err));
}

export async function streamDownload({ shop, fileId, orderId }) {
  if (!fileId) return new Response("Missing file ID.", { status: 400 });

  let file;
  try {
    file = await prisma.productFile.findUnique({ where: { id: fileId } });
  } catch {
    return new Response("Database error.", { status: 500 });
  }

  if (!file) return new Response("File not found.", { status: 404 });
  if (file.shop !== shop) return new Response("File not found.", { status: 404 });
  if (!file.downloadEnabled) {
    return new Response("This file is no longer available for download.", { status: 403 });
  }

  // Per-order cap. Only applied when merchant has set a cap AND we have an
  // orderId to scope the count. DB lookup fails open so a transient hiccup
  // never blocks a legit customer.
  if (file.maxDownloadsPerOrder != null && orderId) {
    let used = 0;
    try {
      const row = await prisma.fileOrderDownload.findUnique({
        where: { fileId_orderId: { fileId: file.id, orderId } },
      });
      used = row?.count ?? 0;
    } catch (err) {
      console.error("[Pendora] Download-limit lookup failed (failing open):", err?.message ?? err);
      used = 0;
    }
    if (used >= file.maxDownloadsPerOrder) {
      return new Response(
        `Download limit reached (${used} of ${file.maxDownloadsPerOrder} used). Contact the seller if you need another copy.`,
        { status: 403 },
      );
    }
  }

  const hasChunks = file.chunkUrls && typeof file.chunkUrls === "string";
  if (!hasChunks && !file.fileUrl) {
    return new Response("File not found.", { status: 404 });
  }

  const rawName = file.fileName || "download";
  const safeName = rawName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  const encodedName = encodeURIComponent(rawName);
  const baseHeaders = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, no-store",
  };

  // Chunked file — validate URLs then stream all chunks sequentially
  if (hasChunks) {
    let chunkUrls;
    try { chunkUrls = JSON.parse(file.chunkUrls); } catch { return new Response("Invalid chunk data.", { status: 500 }); }

    for (const curl of chunkUrls) {
      if (!isValidCdnUrl(curl)) return new Response("Invalid chunk URL origin.", { status: 500 });
    }

    if (file.fileSize) baseHeaders["Content-Length"] = String(file.fileSize);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (const chunkUrl of chunkUrls) {
            let res;
            try {
              res = await fetchWithRetry(chunkUrl, 3, 500);
            } catch (err) {
              controller.error(new Error(`Chunk fetch failed: ${err?.message ?? err}`));
              return;
            }
            const reader = res.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          }
          controller.close();
        } catch (err) { controller.error(err); }
      },
    });
    incrementDownloadCount({ shop, fileId: file.id, orderId });
    return new Response(stream, { status: 200, headers: baseHeaders });
  }

  // Single file — validate URL then stream from CDN
  if (!isValidCdnUrl(file.fileUrl)) return new Response("Invalid file URL.", { status: 500 });

  let cdnRes;
  try { cdnRes = await fetchWithRetry(file.fileUrl, 3, 500); } catch { return new Response("Failed to reach CDN.", { status: 502 }); }
  if (!cdnRes.ok) return new Response("File unavailable.", { status: 502 });

  const contentLength = cdnRes.headers.get("content-length");
  if (contentLength) baseHeaders["Content-Length"] = contentLength;

  incrementDownloadCount({ shop, fileId: file.id, orderId });
  return new Response(cdnRes.body, { status: 200, headers: baseHeaders });
}
