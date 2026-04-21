import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncProductFilesMetafield, buildFilesPayload } from "../utils/metafield.server";

/**
 * Clone an existing file to a new product — instant, no re-upload.
 * Creates a new ProductFile record with same file data but new productId.
 */
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const { fileIds, productId, productTitle, maxDownloadsPerOrder } = body;
  if (!fileIds?.length || !productId) {
    return Response.json({ error: "Missing fileIds or productId." }, { status: 400 });
  }

  // Normalize: undefined/null/""/non-positive → null (unlimited). When the merchant
  // explicitly sets a cap in the wizard it overrides the source file's own cap.
  let resolvedLimit = null;
  if (maxDownloadsPerOrder !== undefined && maxDownloadsPerOrder !== null && maxDownloadsPerOrder !== "") {
    const n = typeof maxDownloadsPerOrder === "number" ? maxDownloadsPerOrder : parseInt(String(maxDownloadsPerOrder), 10);
    resolvedLimit = Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
  }

  // Fetch source files
  const sourceFiles = await prisma.productFile.findMany({
    where: { id: { in: fileIds }, shop },
  });

  if (!sourceFiles.length) {
    return Response.json({ error: "Source files not found." }, { status: 404 });
  }

  // Clone each file to the new product. If merchant provided an explicit limit in
  // the wizard, use that; otherwise inherit the source file's existing limit.
  const cloned = await prisma.$transaction(
    sourceFiles.map((f) =>
      prisma.productFile.create({
        data: {
          shop,
          productId,
          productTitle: productTitle || "",
          fileName: f.fileName,
          fileUrl: f.fileUrl,
          chunkUrls: f.chunkUrls,
          mimeType: f.mimeType,
          fileSize: f.fileSize,
          displayName: f.displayName || f.fileName,
          downloadEnabled: true,
          maxDownloadsPerOrder: maxDownloadsPerOrder !== undefined ? resolvedLimit : f.maxDownloadsPerOrder,
          status: "ready",
        },
      })
    )
  );

  // Sync metafield for the new product — fire-and-forget, logs userErrors.
  const allFiles = await prisma.productFile.findMany({
    where: { shop, productId },
    orderBy: { createdAt: "desc" },
  });
  void syncProductFilesMetafield(admin, productId, buildFilesPayload(allFiles));

  return Response.json({ saved: cloned.map((c) => ({ fileId: c.id, fileName: c.fileName })) });
};
