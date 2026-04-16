import crypto from "crypto";

const ALG = "aes-256-gcm";

function getKey() {
  const secret = process.env.SHOPIFY_API_SECRET || "";
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(text) {
  if (!text) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(data) {
  if (!data || !data.includes(":")) return "";
  try {
    const [ivHex, tagHex, encHex] = data.split(":");
    const decipher = crypto.createDecipheriv(ALG, getKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(encHex, "hex"), undefined, "utf8") + decipher.final("utf8");
  } catch {
    return "";
  }
}
