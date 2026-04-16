import crypto from "crypto";
import prisma from "../db.server";

/**
 * App Proxy download endpoint.
 * URL: https://{store}.myshopify.com/apps/pendora/api/download/:fileId
 * Shopify appends shop, timestamp, signature, etc. as query params.
 *
 * Security layers:
 *  1. Verify Shopify proxy HMAC signature (proves request came via Shopify proxy)
 *  2. Check file.shop === shop from proxy (prevents cross-shop access)
 *  3. Check downloadEnabled flag
 *  4. Validate CDN URLs before fetching (prevents SSRF)
 */

function verifyProxySignature(searchParams) {
  const signature = searchParams.get("signature");
  if (!signature) return false;

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;

  // Collect all params except 'signature', sort alphabetically, concat key=value
  const pairs = [];
  for (const [key, value] of searchParams.entries()) {
    if (key !== "signature") pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const message = pairs.join("");

  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex");

  try {
    const sigBuf = Buffer.from(signature, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

function isValidCdnUrl(urlStr) {
  try {
    const h = new URL(urlStr).hostname;
    return h.endsWith(".shopifycdn.com") || h.endsWith(".shopify.com") || h.endsWith(".googleapis.com");
  } catch { return false; }
}

export const loader = async ({ request, params }) => {
  const { fileId } = params;
  if (!fileId) return new Response("Missing file ID.", { status: 400 });

  // 1. Verify Shopify App Proxy signature
  const url = new URL(request.url);
  if (!verifyProxySignature(url.searchParams)) {
    return new Response("Unauthorized.", { status: 401 });
  }

  const shop = url.searchParams.get("shop") || "";

  let file;
  try {
    file = await prisma.productFile.findUnique({ where: { id: fileId } });
  } catch {
    return new Response("Database error.", { status: 500 });
  }

  if (!file) {
    return new Response("File not found.", { status: 404 });
  }

  // 2. Shop ownership check
  if (file.shop !== shop) {
    return new Response("File not found.", { status: 404 });
  }

  // 3. downloadEnabled check
  if (!file.downloadEnabled) {
    return new Response("This file is no longer available for download.", { status: 403 });
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

    // 4. Validate every chunk URL is from Shopify CDN
    for (const curl of chunkUrls) {
      if (!isValidCdnUrl(curl)) {
        return new Response("Invalid chunk URL origin.", { status: 500 });
      }
    }

    if (file.fileSize) baseHeaders["Content-Length"] = String(file.fileSize);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (const chunkUrl of chunkUrls) {
            const res = await fetch(chunkUrl);
            if (!res.ok) { controller.error(new Error(`Chunk fetch failed (${res.status})`)); return; }
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
    return new Response(stream, { status: 200, headers: baseHeaders });
  }

  // Single file — validate URL then stream from CDN
  if (!isValidCdnUrl(file.fileUrl)) {
    return new Response("Invalid file URL.", { status: 500 });
  }

  let cdnRes;
  try { cdnRes = await fetch(file.fileUrl); } catch { return new Response("Failed to reach CDN.", { status: 502 }); }
  if (!cdnRes.ok) return new Response("File unavailable.", { status: 502 });

  const contentLength = cdnRes.headers.get("content-length");
  if (contentLength) baseHeaders["Content-Length"] = contentLength;

  return new Response(cdnRes.body, { status: 200, headers: baseHeaders });
};
