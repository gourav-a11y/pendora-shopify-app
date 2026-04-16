import prisma from "../db.server";
import { generateDownloadToken } from "../utils/token.server";
import { unauthenticated } from "../shopify.server";

function getCorsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  let allowed = "";
  try {
    const hostname = new URL(origin).hostname;
    if (hostname.endsWith(".myshopify.com") || hostname === "myshopify.com") {
      allowed = origin;
    }
  } catch {}
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Handle CORS preflight (OPTIONS) and block GET
export const loader = async ({ request }) => {
  return new Response(null, {
    status: request.method === "OPTIONS" ? 204 : 405,
    headers: getCorsHeaders(request),
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
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400, headers: getCorsHeaders(request) });
  }

  const { orderId, shop } = body || {};
  if (!orderId || !shop) {
    return Response.json({ error: "Missing orderId or shop." }, { status: 400, headers: getCorsHeaders(request) });
  }

  // Validate shop format
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
    return Response.json({ error: "Invalid shop." }, { status: 400, headers: getCorsHeaders(request) });
  }

  // Prevent cross-shop access: origin hostname must match the shop parameter
  const origin = request.headers.get("origin") || "";
  try {
    const originHost = new URL(origin).hostname;
    if (originHost !== shop) {
      return Response.json({ error: "Origin mismatch." }, { status: 403, headers: getCorsHeaders(request) });
    }
  } catch {
    return Response.json({ error: "Invalid origin." }, { status: 403, headers: getCorsHeaders(request) });
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
    return Response.json({ products: [] }, { headers: getCorsHeaders(request) });
  }

  console.log("[Pendora] /api/downloads orderId:", normalizedOrderId, "productIds:", productIds);

  if (!productIds.length) {
    return Response.json({ products: [] }, { headers: getCorsHeaders(request) });
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

  return Response.json({ products: Object.values(productMap) }, { headers: getCorsHeaders(request) });
};
