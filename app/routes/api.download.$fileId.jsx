import prisma from "../db.server";

/**
 * App Proxy download endpoint — forces file download with Content-Disposition: attachment.
 * URL (via proxy): https://{store}.myshopify.com/apps/pendora/api/download/:fileId
 * Shopify proxies this to: {tunnel}/api/download/:fileId
 *
 * No token needed — request is authenticated by Shopify proxy signature.
 * FileId is a CUID (hard to guess) which provides sufficient security.
 */
export const loader = async ({ request, params }) => {
  const { fileId } = params;
  if (!fileId) return new Response("Missing file ID.", { status: 400 });

  let file;
  try {
    file = await prisma.productFile.findUnique({ where: { id: fileId } });
  } catch (err) {
    return new Response("Database error.", { status: 500 });
  }

  if (!file || !file.fileUrl) {
    return new Response("File not found.", { status: 404 });
  }

  // Fetch file from Shopify CDN and proxy it with download headers
  let cdnRes;
  try {
    cdnRes = await fetch(file.fileUrl);
  } catch {
    return new Response("Failed to fetch file.", { status: 502 });
  }

  if (!cdnRes.ok) {
    return new Response("File unavailable.", { status: 404 });
  }

  const filename = encodeURIComponent(file.displayName || file.fileName || "download");

  return new Response(cdnRes.body, {
    status: 200,
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
