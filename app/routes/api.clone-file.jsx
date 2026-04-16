import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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

  const { fileIds, productId, productTitle } = body;
  if (!fileIds?.length || !productId) {
    return Response.json({ error: "Missing fileIds or productId." }, { status: 400 });
  }

  // Fetch source files
  const sourceFiles = await prisma.productFile.findMany({
    where: { id: { in: fileIds }, shop },
  });

  if (!sourceFiles.length) {
    return Response.json({ error: "Source files not found." }, { status: 404 });
  }

  // Clone each file to the new product
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
          status: "ready",
        },
      })
    )
  );

  // Sync metafield for the new product
  const allFiles = await prisma.productFile.findMany({
    where: { shop, productId },
    orderBy: { createdAt: "desc" },
  });
  const value = JSON.stringify(
    allFiles.map((af) => ({
      fileId: af.id,
      displayName: af.displayName || af.fileName,
      fileUrl: af.fileUrl || (af.chunkUrls ? JSON.parse(af.chunkUrls)[0] : null),
    }))
  );
  admin.graphql(
    `mutation SyncMetafield($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`,
    { variables: { m: [{ ownerId: productId, namespace: "pendora", key: "files", type: "json", value }] } }
  ).catch(() => {});

  return Response.json({ saved: cloned.map((c) => ({ fileId: c.id, fileName: c.fileName })) });
};
