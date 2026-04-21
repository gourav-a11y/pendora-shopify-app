import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendMail, friendlyMailError } from "../utils/mailer.server";
import { syncProductFilesMetafield, buildFilesPayload } from "../utils/metafield.server";
import { encodeDeliveryToken } from "../utils/token.server";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const { _action } = body;

  // ── Delete file ────────────────────────────────────────────────────────────
  if (_action === "delete") {
    const { fileId } = body;
    if (!fileId) return Response.json({ error: "Missing file ID." }, { status: 400 });

    const file = await prisma.productFile.findFirst({ where: { id: fileId, shop } });
    if (!file) return Response.json({ error: "File not found." }, { status: 404 });

    await prisma.productFile.deleteMany({ where: { id: fileId, shop } });

    // Sync metafield for the product — fire-and-forget, logs userErrors.
    const remaining = await prisma.productFile.findMany({ where: { shop, productId: file.productId }, orderBy: { createdAt: "desc" } });
    void syncProductFilesMetafield(admin, file.productId, buildFilesPayload(remaining));

    return Response.json({ success: true, productRemoved: remaining.length === 0 });
  }

  // ── Update per-order download limit (single file) ─────────────────────────
  if (_action === "set-limit") {
    const { fileId, maxDownloadsPerOrder } = body;
    if (!fileId) return Response.json({ error: "Missing file ID." }, { status: 400 });
    // Normalize: empty / null / non-positive → null (unlimited); positive int → floor.
    let limit = null;
    if (maxDownloadsPerOrder !== null && maxDownloadsPerOrder !== undefined && maxDownloadsPerOrder !== "") {
      const n = typeof maxDownloadsPerOrder === "number" ? maxDownloadsPerOrder : parseInt(String(maxDownloadsPerOrder), 10);
      if (Number.isFinite(n) && n >= 1) limit = Math.floor(n);
    }
    const updated = await prisma.productFile.updateMany({
      where: { id: fileId, shop },
      data: { maxDownloadsPerOrder: limit },
    });
    if (!updated.count) return Response.json({ error: "File not found." }, { status: 404 });
    return Response.json({ success: true, maxDownloadsPerOrder: limit });
  }

  // ── Replace file ───────────────────────────────────────────────────────────
  if (_action === "replace") {
    const { fileId, resourceUrl, chunkUrls, filename, mimeType, fileSize } = body;
    if (!fileId) return Response.json({ error: "Missing file ID." }, { status: 400 });
    if (!resourceUrl && !chunkUrls?.length) return Response.json({ error: "No file data." }, { status: 400 });

    const file = await prisma.productFile.findFirst({ where: { id: fileId, shop } });
    if (!file) return Response.json({ error: "File not found." }, { status: 404 });

    // Update file record with new data
    await prisma.productFile.update({
      where: { id: fileId },
      data: {
        fileName: filename || file.fileName,
        fileUrl: chunkUrls?.length ? null : (resourceUrl || file.fileUrl),
        chunkUrls: chunkUrls?.length ? JSON.stringify(chunkUrls) : null,
        mimeType: mimeType || file.mimeType,
        fileSize: fileSize != null ? BigInt(fileSize) : file.fileSize,
        displayName: filename || file.displayName,
        status: "ready",
      },
    });

    // Sync metafield — fire-and-forget, logs userErrors.
    const allFiles = await prisma.productFile.findMany({ where: { shop, productId: file.productId }, orderBy: { createdAt: "desc" } });
    void syncProductFilesMetafield(admin, file.productId, buildFilesPayload(allFiles));

    // Background: notify previous purchasers
    notifyPreviousPurchasers(shop, file, filename || file.fileName).catch((err) =>
      console.error("[Pendora] Replace notify error:", err?.message ?? err)
    );

    return Response.json({ success: true });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
};

/** Find customers who received this file and send them update email */
async function notifyPreviousPurchasers(shop, oldFile, newFileName) {
  // Find all email logs that included this file
  const logs = await prisma.emailLog.findMany({
    where: { shop, productId: oldFile.productId, status: "sent" },
    orderBy: { createdAt: "desc" },
  });

  // Dedupe by customerEmail
  const seen = new Set();
  const uniqueCustomers = [];
  for (const log of logs) {
    if (!seen.has(log.customerEmail)) {
      seen.add(log.customerEmail);
      uniqueCustomers.push(log);
    }
  }

  if (!uniqueCustomers.length) return;

  const shopName = shop.replace(".myshopify.com", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Load template for button color
  const tpl = await prisma.emailTemplate.findUnique({ where: { shop } });
  const buttonColor = tpl?.buttonColor || "#1B2B44";

  // Clean file name for display
  const cleanName = newFileName.replace(/\.[^.]+$/, "").replace(/[-_\.~!@#$%^&*()+=\[\]{}|\\:;"'<>,?/]+/g, " ").replace(/\s+/g, " ").trim() || "File";
  const fileExt = (newFileName.split(".").pop() || "").toUpperCase();

  for (const customer of uniqueCustomers) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F6F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:32px 16px">
  <div style="background:#fff;border-radius:12px;border:1px solid #E1E3E5;overflow:hidden">
    <div style="background:${buttonColor};padding:24px 28px;text-align:center">
      <div style="color:#fff;font-size:20px;font-weight:800">${shopName}</div>
    </div>
    <div style="padding:28px">
      <div style="font-size:18px;font-weight:700;color:#303030;margin-bottom:12px">Hi ${customer.customerName},</div>
      <div style="font-size:15px;color:#6D7175;line-height:1.7;margin-bottom:20px">
        A file from your purchase has been updated! The latest version of <strong style="color:#303030">${cleanName}</strong> is now available for download.
      </div>
      <div style="margin:16px 0;border:1px solid #E1E3E5;border-radius:10px;overflow:hidden">
        <div style="background:#F6F6F7;padding:12px 16px;font-weight:700;font-size:15px;color:#303030;border-bottom:1px solid #E1E3E5">${oldFile.productTitle || "Digital Product"}</div>
        <table style="width:100%;border-collapse:collapse"><tr>
          <td style="padding:14px 16px">
            <div style="margin-bottom:10px">
              <span style="display:inline-block;background:rgba(245,165,36,0.12);color:#D48A06;font-size:10px;font-weight:800;padding:3px 8px;border-radius:5px;letter-spacing:0.3px;vertical-align:middle;margin-right:8px">${fileExt}</span>
              <span style="font-size:15px;font-weight:600;color:#303030;vertical-align:middle">${cleanName}</span>
            </div>
            <a href="https://${shop}/apps/pendora/api/dl/${encodeDeliveryToken({ fileId: oldFile.id, orderId: customer.orderId, expDays: 30 })}" style="display:inline-block;padding:10px 28px;background:${buttonColor};color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700">Download</a>
          </td>
        </tr></table>
      </div>
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #E1E3E5;font-size:14px;color:#6D7175">Thanks for being a customer!</div>
    </div>
    <div style="padding:16px 28px;background:#F6F6F7;text-align:center;font-size:11px;color:#999">Sent from ${shopName} &middot; Powered by Pendora</div>
  </div>
</div></body></html>`;

    try {
      await sendMail({
        from: "gourav@pumper.run",
        fromName: "Pendora",
        to: customer.customerEmail,
        subject: `Updated file available: ${newFileName}`,
        html,
      });

      await prisma.emailLog.create({
        data: {
          shop, orderId: customer.orderId, orderNumber: customer.orderNumber,
          customerName: customer.customerName, customerEmail: customer.customerEmail,
          productId: oldFile.productId, productTitle: oldFile.productTitle || "Digital Product",
          fileIds: JSON.stringify([oldFile.id]),
          status: "sent", tokenExpiry: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      });
      console.log(`[Pendora] Update notification sent to ${customer.customerEmail} for replaced file ${newFileName}`);
    } catch (err) {
      console.error(`[Pendora] Update notify failed for ${customer.customerEmail}:`, err?.message ?? err);
      // Record failure so the merchant can see it in the delivery log.
      try {
        await prisma.emailLog.create({
          data: {
            shop, orderId: customer.orderId, orderNumber: customer.orderNumber,
            customerName: customer.customerName, customerEmail: customer.customerEmail,
            productId: oldFile.productId, productTitle: oldFile.productTitle || "Digital Product",
            fileIds: JSON.stringify([oldFile.id]),
            status: "failed",
            error: friendlyMailError(err),
            tokenExpiry: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          },
        });
      } catch (logErr) {
        console.error("[Pendora] Failed to write emailLog failed-row:", logErr?.message ?? logErr);
      }
    }
  }
}
