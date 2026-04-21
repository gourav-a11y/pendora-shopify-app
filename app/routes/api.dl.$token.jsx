import crypto from "crypto";
import { decodeDeliveryToken } from "../utils/token.server";
import { streamDownload } from "../utils/download.server";

/**
 * Tokenized App Proxy download endpoint.
 * URL: /apps/pendora/api/dl/:token
 *
 * The token is an opaque signed blob that wraps { fileId, orderId, exp } — so the
 * raw fileId and orderId are hidden from casual viewers of the customer's email link.
 *
 * Security layers:
 *  1. Shopify App Proxy HMAC signature (proves request came via the proxy)
 *  2. Delivery token HMAC signature (proves fileId/orderId pair wasn't forged
 *     and hasn't expired)
 *  3. streamDownload() enforces shop-ownership, downloadEnabled, per-order limit,
 *     and CDN URL whitelist.
 */

function verifyProxySignature(searchParams) {
  const signature = searchParams.get("signature");
  if (!signature) return false;

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;

  const pairs = [];
  for (const [key, value] of searchParams.entries()) {
    if (key !== "signature") pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const message = pairs.join("");

  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex");

  try {
    const sigBuf = Buffer.from(signature, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

export const loader = async ({ request, params }) => {
  const { token } = params;
  if (!token) return new Response("Missing token.", { status: 400 });

  const url = new URL(request.url);
  if (!verifyProxySignature(url.searchParams)) {
    return new Response("Unauthorized.", { status: 401 });
  }

  const decoded = decodeDeliveryToken(token);
  if (!decoded) {
    return new Response("This download link is invalid or has expired.", { status: 403 });
  }

  const shop = url.searchParams.get("shop") || "";
  return streamDownload({ shop, fileId: decoded.fileId, orderId: decoded.orderId });
};
