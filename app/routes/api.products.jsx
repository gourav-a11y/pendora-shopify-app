import { authenticate } from "../shopify.server";

// ── Per-shop cache — ONLY for the default "first page, no search" call ──
// Paginated or search requests bypass cache (rare, and cache keys would explode).
const cache = new Map(); // shop → { data, pageInfo, expiresAt }
const TTL = 5 * 60 * 1000; // 5 minutes
const DEFAULT_FIRST = 20;
const MAX_FIRST = 50;

export function invalidateProductsCache(shop) {
  cache.delete(shop);
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const firstRaw = parseInt(url.searchParams.get("first") || String(DEFAULT_FIRST), 10);
  const first = Math.min(MAX_FIRST, Math.max(1, Number.isFinite(firstRaw) ? firstRaw : DEFAULT_FIRST));
  const after = url.searchParams.get("after") || null;
  const search = (url.searchParams.get("search") || "").trim();

  const isDefaultCall = first === DEFAULT_FIRST && !after && !search;

  // Serve from cache if this is the default call and cache is fresh
  if (isDefaultCall) {
    const cached = cache.get(shop);
    if (cached && cached.expiresAt > Date.now()) {
      return Response.json({ products: cached.data, pageInfo: cached.pageInfo });
    }
  }

  let products = [];
  let pageInfo = { hasNextPage: false, endCursor: null };
  try {
    const res = await Promise.race([
      admin.graphql(
        `#graphql
        query getProducts($first: Int!, $after: String, $query: String) {
          products(first: $first, after: $after, sortKey: TITLE, query: $query) {
            edges { cursor node { id title status featuredImage { url } } }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { variables: { first, after, query: search || null } }
      ),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 25000)),
    ]);
    const data = await res.json();
    const conn = data?.data?.products;
    products = (conn?.edges ?? []).map((e) => e.node);
    pageInfo = {
      hasNextPage: !!conn?.pageInfo?.hasNextPage,
      endCursor: conn?.pageInfo?.endCursor ?? null,
    };
  } catch {
    // Timeout or API error — if default call, return stale cache when available.
    if (isDefaultCall) {
      const cached = cache.get(shop);
      if (cached) return Response.json({ products: cached.data, pageInfo: cached.pageInfo });
    }
  }

  if (isDefaultCall) {
    cache.set(shop, { data: products, pageInfo, expiresAt: Date.now() + TTL });
  }

  return Response.json({ products, pageInfo });
};
