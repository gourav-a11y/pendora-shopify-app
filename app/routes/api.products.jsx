import { authenticate } from "../shopify.server";

// ── Per-shop in-memory cache — survives across requests in the same process ──
const cache = new Map(); // shop → { data: Product[], expiresAt: number }
const TTL = 5 * 60 * 1000; // 5 minutes

export function invalidateProductsCache(shop) {
  cache.delete(shop);
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Serve from cache if fresh
  const cached = cache.get(shop);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ products: cached.data });
  }

  let products = [];
  try {
    const res = await Promise.race([
      admin.graphql(`#graphql
        query getProducts {
          products(first: 100, sortKey: TITLE) {
            edges { node { id title status featuredImage { url } } }
          }
        }
      `),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 25000)),
    ]);
    const data = await res.json();
    products = (data.data?.products?.edges ?? []).map((e) => e.node);
  } catch {
    // Timeout or API error — return stale cache if available, else empty
    if (cached) return Response.json({ products: cached.data });
  }

  cache.set(shop, { data: products, expiresAt: Date.now() + TTL });
  return Response.json({ products });
};
