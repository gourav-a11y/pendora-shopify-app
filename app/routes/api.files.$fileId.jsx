import { verifyDownloadToken } from "../utils/token.server";
import prisma from "../db.server";

// Retry a CDN fetch a few times before giving up — Shopify occasionally 503s.
// Only safe to call BEFORE any bytes have been enqueued on the response stream.
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

/**
 * Public download endpoint — no Shopify auth required.
 * Access is controlled via a short-lived signed token.
 * URL: /api/files/:fileId?token=<signed-token>
 */
export const loader = async ({ request, params }) => {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const { fileId } = params;

    if (!token || !verifyDownloadToken(token, fileId)) {
      return new Response("Unauthorized: invalid or expired token.", { status: 401 });
    }

    const file = await prisma.productFile.findUnique({ where: { id: fileId } });

    if (!file) {
      return new Response("File not found.", { status: 404 });
    }

    if (!file.downloadEnabled) {
      return new Response("This file is no longer available for download.", { status: 403 });
    }

    const hasChunks = file.chunkUrls && typeof file.chunkUrls === "string";
    if (!hasChunks && !file.fileUrl) {
      return new Response("File URL not available.", { status: 404 });
    }

    // Single file — 302 redirect (fast, as before)
    if (!hasChunks) {
      // Validate URL is from Shopify CDN to prevent open redirect
      try {
        const u = new URL(file.fileUrl);
        if (!u.hostname.endsWith(".shopifycdn.com") && !u.hostname.endsWith(".shopify.com") && !u.hostname.endsWith(".googleapis.com")) {
          return new Response("Invalid file URL.", { status: 500 });
        }
      } catch { return new Response("Invalid file URL.", { status: 500 }); }
      return new Response(null, { status: 302, headers: { Location: file.fileUrl, "Cache-Control": "no-store" } });
    }

    // Chunked file — stream all chunks sequentially
    let chunkUrls;
    try { chunkUrls = JSON.parse(file.chunkUrls); } catch { return new Response("Invalid chunk data.", { status: 500 }); }

    // Validate every chunk URL is from Shopify CDN
    for (const curl of chunkUrls) {
      try {
        const h = new URL(curl).hostname;
        if (!h.endsWith(".shopifycdn.com") && !h.endsWith(".shopify.com") && !h.endsWith(".googleapis.com")) {
          return new Response("Invalid chunk URL origin.", { status: 500 });
        }
      } catch { return new Response("Invalid chunk URL.", { status: 500 }); }
    }

    const filename = (file.fileName || "download").replace(/"/g, '\\"');
    const headers = {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    };
    if (file.fileSize) headers["Content-Length"] = String(file.fileSize);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (const url of chunkUrls) {
            // Retry the initial fetch (not mid-stream — mid-stream errors must abort).
            let res;
            try {
              res = await fetchWithRetry(url, 3, 500);
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
    return new Response(stream, { status: 200, headers });
  } catch (err) {
    console.error("[Pendora] /api/files download error:", err?.message ?? err);
    return new Response("Download failed. Please try again.", { status: 500 });
  }
};
