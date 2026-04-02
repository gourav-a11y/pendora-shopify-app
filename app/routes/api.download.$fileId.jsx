import prisma from "../db.server";

/**
 * App Proxy download endpoint.
 * URL: https://{store}.myshopify.com/apps/pendora/api/download/:fileId
 * Shopify verifies the proxy HMAC before forwarding here.
 *
 * Streams file from Shopify CDN with Content-Disposition: attachment so the
 * browser always triggers a download (never an inline preview).
 *
 * Uses response.body (ReadableStream) — no buffering, bytes flow to the
 * browser as they arrive from CDN, so download starts immediately.
 */
export const loader = async ({ params }) => {
  const { fileId } = params;
  if (!fileId) return new Response("Missing file ID.", { status: 400 });

  let file;
  try {
    file = await prisma.productFile.findUnique({ where: { id: fileId } });
  } catch {
    return new Response("Database error.", { status: 500 });
  }

  const hasChunks = file?.chunkUrls && typeof file.chunkUrls === "string";
  if (!hasChunks && !file?.fileUrl) {
    return new Response("File not found.", { status: 404 });
  }

  const filename = (file.fileName || "download").replace(/"/g, '\\"');
  const baseHeaders = {
    "Content-Type": file.mimeType || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  };

  // Chunked file — stream all chunks sequentially
  if (hasChunks) {
    let chunkUrls;
    try { chunkUrls = JSON.parse(file.chunkUrls); } catch { return new Response("Invalid chunk data.", { status: 500 }); }
    if (file.fileSize) baseHeaders["Content-Length"] = String(file.fileSize);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (const url of chunkUrls) {
            const res = await fetch(url);
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

  // Single file — stream from CDN
  let cdnRes;
  try { cdnRes = await fetch(file.fileUrl); } catch { return new Response("Failed to reach CDN.", { status: 502 }); }
  if (!cdnRes.ok) return new Response("File unavailable.", { status: 502 });

  const contentLength = cdnRes.headers.get("content-length");
  if (contentLength) baseHeaders["Content-Length"] = contentLength;
  if (cdnRes.headers.get("content-type")) baseHeaders["Content-Type"] = cdnRes.headers.get("content-type");

  return new Response(cdnRes.body, { status: 200, headers: baseHeaders });
};
