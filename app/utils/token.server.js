import crypto from "crypto";

const getSecret = () => {
  const s = process.env.SHOPIFY_API_SECRET;
  if (!s) throw new Error("SHOPIFY_API_SECRET environment variable is required");
  return s;
};

/**
 * Generate a signed download token for a file.
 * Token expires in 1 hour.
 */
export function generateDownloadToken(fileId) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ fileId, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/**
 * Generate a long-lived download token for email links.
 * Token expires in 7 days.
 */
export function generateEmailDownloadToken(fileId) {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const payload = Buffer.from(JSON.stringify({ fileId, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/**
 * Opaque delivery token carried in customer-facing URLs. Wraps { fileId, orderId }
 * in a signed + base64-encoded blob so the URL itself doesn't expose either value.
 * Decoded by the /api/dl/:token route, which then applies the same shop /
 * downloadEnabled / maxDownloadsPerOrder checks as the fileId route.
 *
 * NOTE: This is ON TOP OF the Shopify App Proxy HMAC. The App Proxy signs every
 * request so an attacker can't just craft a URL; this extra token is to mask the
 * payload values (fileId CUID, orderId) from casual viewers of the email link.
 */
export function encodeDeliveryToken({ fileId, orderId = null, expDays = 30 }) {
  const payload = {
    f: fileId,
    o: orderId || null,
    e: Math.floor(Date.now() / 1000) + (expDays * 24 * 3600),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  // 32-char truncated HMAC keeps the token reasonably short while still providing
  // 128 bits of integrity (App Proxy HMAC remains the primary auth).
  const sig = crypto.createHmac("sha256", getSecret()).update(payloadB64).digest("hex").slice(0, 32);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify + decode a delivery token. Returns { fileId, orderId } on success, null
 * on bad signature / malformed payload / expired token.
 */
export function decodeDeliveryToken(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payloadB64 = token.substring(0, dot);
  const sig = token.substring(dot + 1);

  const expected = crypto.createHmac("sha256", getSecret()).update(payloadB64).digest("hex").slice(0, 32);
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  } catch {
    return null;
  }
  if (!payload?.f) return null;
  if (typeof payload.e === "number" && payload.e < Math.floor(Date.now() / 1000)) return null;
  return { fileId: String(payload.f), orderId: payload.o || null };
}

/**
 * Verify a download token. Returns true if valid, false otherwise.
 */
export function verifyDownloadToken(token, fileId) {
  try {
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex === -1) return false;

    const payload = token.substring(0, dotIndex);
    const sig = token.substring(dotIndex + 1);

    const expectedSig = crypto
      .createHmac("sha256", getSecret())
      .update(payload)
      .digest("hex");

    // Constant-time comparison to prevent timing attacks
    const sigBuf = Buffer.from(sig, "hex");
    const expectedBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expectedBuf.length) return false;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

    const { fileId: tokenFileId, exp } = JSON.parse(
      Buffer.from(payload, "base64url").toString()
    );

    if (tokenFileId !== fileId) return false;
    if (exp < Math.floor(Date.now() / 1000)) return false;

    return true;
  } catch {
    return false;
  }
}
