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

  // Redirect directly to Shopify CDN — browser downloads at full CDN speed,
  // no tunnel proxying, no double-hop. Start time < 1s.
  return Response.redirect(file.fileUrl, 302);
};
