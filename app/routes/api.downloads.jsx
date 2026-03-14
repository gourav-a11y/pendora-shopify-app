import prisma from "../db.server";
import { generateDownloadToken } from "../utils/token.server";
import { unauthenticated } from "../shopify.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Handle CORS preflight (OPTIONS) and block GET
export const loader = async ({ request }) => {
  return new Response(null, {
    status: request.method === "OPTIONS" ? 204 : 405,
    headers: CORS,
  });
};

/**
 * Public endpoint called by the Thank You page checkout extension.
 * Input:  { orderId: string, shop: string }
 * Output: { products: [{ productId, productTitle, files: [{ fileId, displayName, downloadToken }] }] }
 *
 * Fetches line items from Shopify Admin API using the order GID, then returns
 * files where downloadEnabled = true. Tokens are HMAC-signed + expire in 1 hour.
 */
export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400, headers: CORS });
  }

  const { orderId, shop } = body || {};
  if (!orderId || !shop) {
    return Response.json({ error: "Missing orderId or shop." }, { status: 400, headers: CORS });
  }

  // orderConfirmation.order.id returns "gid://shopify/OrderIdentity/..." but
  // Admin GraphQL order() query requires "gid://shopify/Order/..."
  const numericId = String(orderId).split("/").pop();
  const normalizedOrderId = `gid://shopify/Order/${numericId}`;

  // Fetch order line items via Shopify Admin GraphQL (uses stored offline session)
  let productIds;
  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
      query GetOrderLineItems($id: ID!) {
        order(id: $id) {
          lineItems(first: 50) {
            nodes {
              product {
                id
              }
            }
          }
        }
      }`,
      { variables: { id: normalizedOrderId } }
    );
    const data = await response.json();
    productIds = (data.data?.order?.lineItems?.nodes ?? [])
      .map((item) => item.product?.id)
      .filter(Boolean);
  } catch (e) {
    console.error("[Pendora] /api/downloads admin query failed:", e?.message ?? e);
    return Response.json({ products: [] }, { headers: CORS });
  }

  console.log("[Pendora] /api/downloads orderId:", normalizedOrderId, "productIds:", productIds);

  if (!productIds.length) {
    return Response.json({ products: [] }, { headers: CORS });
  }

  const files = await prisma.productFile.findMany({
    where: {
      shop,
      productId: { in: productIds },
      downloadEnabled: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Group by productId
  const productMap = {};
  for (const f of files) {
    if (!productMap[f.productId]) {
      productMap[f.productId] = {
        productId: f.productId,
        productTitle: f.productTitle || "Unknown Product",
        files: [],
      };
    }
    productMap[f.productId].files.push({
      fileId: f.id,
      displayName: f.displayName || f.fileName,
      downloadToken: generateDownloadToken(f.id),
    });
  }

  return Response.json({ products: Object.values(productMap) }, { headers: CORS });
};
