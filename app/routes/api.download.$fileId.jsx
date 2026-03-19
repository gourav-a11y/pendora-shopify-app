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

  if (!file?.fileUrl) {
    return new Response("File not found.", { status: 404 });
  }

  let cdnRes;
  try {
    cdnRes = await fetch(file.fileUrl);
  } catch {
    return new Response("Failed to reach CDN.", { status: 502 });
  }

  if (!cdnRes.ok) {
    return new Response("File unavailable.", { status: 502 });
  }

  const filename = (file.fileName || "download").replace(/"/g, '\\"');
  const headers = {
    "Content-Type": file.mimeType || cdnRes.headers.get("content-type") || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  };
  const contentLength = cdnRes.headers.get("content-length");
  if (contentLength) headers["Content-Length"] = contentLength;

  return new Response(cdnRes.body, { status: 200, headers });
};
