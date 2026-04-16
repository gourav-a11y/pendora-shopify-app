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
