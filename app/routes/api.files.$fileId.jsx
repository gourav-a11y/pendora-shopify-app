import { verifyDownloadToken } from "../utils/token.server";
import prisma from "../db.server";

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

    if (!file.fileUrl) {
      return new Response("File URL not available.", { status: 404 });
    }

    // Redirect to Shopify CDN URL — fast, no proxy needed
    return new Response(null, {
      status: 302,
      headers: {
        Location: file.fileUrl,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response("Download failed: " + err.message, { status: 500 });
  }
};
