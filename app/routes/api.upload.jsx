import path from "path";
import fs from "fs";
import crypto from "crypto";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { parseMultipart } from "../utils/parseMultipart.server";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
const ALLOWED_EXTENSIONS = [
  ".pdf", ".zip", ".mp3", ".mp4", ".png", ".jpg", ".jpeg",
  ".gif", ".webp", ".mov", ".epub", ".docx", ".xlsx",
];

/**
 * Dedicated upload endpoint — called via XHR to bypass App Bridge's
 * fetch interceptor, which corrupts multipart body streams.
 *
 * Client sends: Authorization: Bearer <idToken> header
 * Body fields: file(s), productId, productTitle, displayName, downloadEnabled
 */
export const action = async ({ request }) => {
  let session;
  try {
    ({ session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) {
      return Response.json({ error: "Authentication failed. Please refresh the page." }, { status: 401 });
    }
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const shop = session.shop;

  let parsed;
  try {
    parsed = await parseMultipart(request);
  } catch (err) {
    return Response.json({ error: "Failed to read upload: " + err.message }, { status: 400 });
  }

  const { fields, files } = parsed;

  if (files.length === 0) {
    return Response.json({ error: "No file provided." }, { status: 400 });
  }

  const productId = (fields.productId || "pending").trim() || "pending";
  const productTitle = (fields.productTitle || "").trim();
  const downloadEnabled = fields.downloadEnabled !== "false";

  const saved = [];
  const errors = [];

  for (const file of files) {
    if (!file || file.size === 0) continue;

    if (file.size > MAX_FILE_SIZE) {
      errors.push(`"${file.filename}" exceeds 5GB limit.`);
      continue;
    }

    const fileExt = path.extname(file.filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(fileExt)) {
      errors.push(`"${file.filename}" — file type "${fileExt}" is not allowed.`);
      continue;
    }

    const displayName = (fields.displayName || "").trim() || file.filename;
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${fileExt}`;
    const filePath = path.join(UPLOAD_DIR, uniqueName);

    try {
      fs.writeFileSync(filePath, file.data);
    } catch (err) {
      errors.push(`"${file.filename}" — failed to save: ${err.message}`);
      continue;
    }

    const record = await prisma.productFile.create({
      data: {
        shop,
        productId,
        productTitle,
        fileName: file.filename,
        filePath,
        mimeType: file.mimetype || "application/octet-stream",
        fileSize: file.size != null ? BigInt(file.size) : null,
        displayName,
        downloadEnabled,
      },
    });

    saved.push({ fileId: record.id, fileName: file.filename, fileSize: file.size });
  }

  if (saved.length === 0) {
    return Response.json({ error: errors[0] || "No valid files uploaded." }, { status: 400 });
  }

  return Response.json({ saved, errors });
};
