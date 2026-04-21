import prisma from "../db.server";
import { encodeDeliveryToken } from "./token.server";
import { sendMail, friendlyMailError } from "./mailer.server";

const DEFAULTS = {
  subject: "Your digital files from {{shop_name}}",
  heading: "Hi {{customer_name}},",
  body: "Thank you for your order #{{order_number}}! Your digital files are ready to download.",
  footer: "Thanks for shopping with us!",
  buttonColor: "#1B2B44",
};

const FROM_EMAIL = "gourav@pumper.run";
const FROM_NAME = "Pendora";
// Merchant alert destination. Falls back to MAIL_USER (the Pendora account)
// so alerts land somewhere the operator actually reads. In production the
// merchant will configure their own alert address via SmtpConfig.
const ALERT_EMAIL = process.env.PENDORA_ALERT_EMAIL || process.env.MAIL_USER || FROM_EMAIL;
// Fail the customer email attempt after this many ms and alert the merchant
// so a silently-stuck SMTP connection doesn't leave a customer without their
// order. Shopify webhook already returned 200 — this just bounds the background job.
const CUSTOMER_EMAIL_TIMEOUT_MS = 180_000;

/**
 * Send a plain warning email to the merchant when something about the order
 * email delivery broke. Never throws — alerts are best-effort; we log to stderr
 * if even the alert fails so at least the operator sees it in dev logs.
 */
async function sendMerchantAlert({ shop, orderNumber, customerEmail, reason, errorDetail }) {
  if (!ALERT_EMAIL) return;
  const shopName = shop ? shop.replace(".myshopify.com", "") : "your store";
  const subject = `[Pendora] Download email NOT delivered for order ${orderNumber || "(unknown)"}`;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F6F6F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:540px;margin:0 auto;padding:32px 16px">
  <div style="background:#fff;border-radius:12px;border:1px solid #E1E3E5;overflow:hidden">
    <div style="background:#D72C0D;padding:20px 24px"><div style="color:#fff;font-size:18px;font-weight:800">⚠ Customer did not receive their download email</div></div>
    <div style="padding:24px">
      <div style="font-size:14px;color:#303030;line-height:1.7;margin-bottom:16px">Pendora was unable to deliver the download email for a paid order on <strong>${shopName}</strong>.</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#303030">
        <tr><td style="padding:6px 0;color:#6D7175;width:130px">Order</td><td>${orderNumber || "(unknown)"}</td></tr>
        <tr><td style="padding:6px 0;color:#6D7175">Customer email</td><td>${customerEmail || "(none on order)"}</td></tr>
        <tr><td style="padding:6px 0;color:#6D7175">Reason</td><td>${reason || ""}</td></tr>
        ${errorDetail ? `<tr><td style="padding:6px 0;color:#6D7175">Details</td><td style="color:#D72C0D;font-family:monospace;font-size:12px">${String(errorDetail).slice(0, 500)}</td></tr>` : ""}
      </table>
      <div style="margin-top:20px;padding:12px 14px;background:#F6F6F7;border-radius:8px;font-size:13px;color:#6D7175;line-height:1.6">
        <strong style="color:#303030">What to do:</strong> Open the Pendora admin → Email &amp; Deliverables → Delivery Log, find this order, and click <strong>Resend</strong>. You can enter a different recipient email from the resend popup if needed.
      </div>
    </div>
  </div>
</div></body></html>`;
  try {
    await sendMail({ from: FROM_EMAIL, fromName: "Pendora Alerts", to: ALERT_EMAIL, subject, html });
    console.log(`[Pendora] Merchant alert sent to ${ALERT_EMAIL} for order ${orderNumber}`);
  } catch (err) {
    console.error(`[Pendora] Merchant alert ALSO failed for order ${orderNumber}:`, err?.message ?? err);
  }
}

function replaceVars(text, vars) {
  let out = text;
  for (const [key, val] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, val || "");
  }
  return out;
}

function formatFileSize(bytes) {
  if (!bytes) return "";
  const n = Number(bytes);
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function cleanFileName(name) {
  if (!name) return "File";
  // Remove extension, replace special chars with spaces, collapse spaces
  const noExt = name.replace(/\.[^.]+$/, "");
  return noExt.replace(/[-_\.~!@#$%^&*()+=\[\]{}|\\:;"'<>,?/]+/g, " ").replace(/\s+/g, " ").trim() || "File";
}

function getFileExt(name) {
  if (!name) return "";
  const ext = name.split(".").pop();
  return ext && ext !== name ? ext.toUpperCase() : "";
}

function buildProductsHtml(products, buttonColor) {
  return products.map(({ productTitle, files }) => {
    const fileRows = files.map((f) => {
      const ext = getFileExt(f.fileName);
      const displayName = cleanFileName(f.displayName || f.fileName);
      return `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #eee">
          <div style="margin-bottom:10px">
            <span style="display:inline-block;background:rgba(245,165,36,0.12);color:#D48A06;font-size:10px;font-weight:800;padding:3px 8px;border-radius:5px;letter-spacing:0.3px;vertical-align:middle;margin-right:8px">${ext}</span>
            <span style="font-size:15px;font-weight:600;color:#303030;vertical-align:middle">${displayName}</span>
            <span style="font-size:12px;color:#999;vertical-align:middle;margin-left:6px">${f.fileSize || ""}</span>
          </div>
          <a href="${f.downloadUrl}" style="display:inline-block;padding:10px 28px;background:${buttonColor};color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700">Download</a>
        </td>
      </tr>
    `;}).join("");
    return `
      <div style="margin:16px 0;border:1px solid #E1E3E5;border-radius:10px;overflow:hidden">
        <div style="background:#F6F6F7;padding:12px 16px;font-weight:700;font-size:15px;color:#303030;border-bottom:1px solid #E1E3E5">
          ${productTitle}
        </div>
        <table style="width:100%;border-collapse:collapse">${fileRows}</table>
      </div>
    `;
  }).join("");
}

function buildEmailHtml({ heading, body, footer, productsHtml, shopName, buttonColor }) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F6F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:32px 16px">
  <div style="background:#fff;border-radius:12px;border:1px solid #E1E3E5;overflow:hidden">
    <div style="background:${buttonColor};padding:24px 28px;text-align:center">
      <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.3px">${shopName}</div>
    </div>
    <div style="padding:28px 28px 12px">
      <div style="font-size:18px;font-weight:700;color:#303030;margin-bottom:12px">${heading}</div>
      <div style="font-size:15px;color:#6D7175;line-height:1.7;margin-bottom:20px">${body}</div>
      ${productsHtml}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #E1E3E5;font-size:14px;color:#6D7175;line-height:1.7">${footer}</div>
    </div>
    <div style="padding:16px 28px;background:#F6F6F7;text-align:center;font-size:11px;color:#999">
      Sent from ${shopName} &middot; Powered by Pendora
    </div>
  </div>
</div>
</body></html>`;
}

/**
 * Send download email for a paid order.
 * Uses custom SMTP mailer — zero third-party email packages.
 * FROM: MAIL_FROM from .env (gourav@pumper.run)
 * TO: customer's checkout email
 */
export async function sendOrderEmail(shop, order) {
  console.log(`[Pendora] sendOrderEmail called for shop=${shop}, orderId=${order?.id}, orderName=${order?.name}`);

  // Load merchant's template (or defaults)
  console.log("[Pendora/send] step 1: loading template");
  const tpl = await prisma.emailTemplate.findUnique({ where: { shop } });
  const template = tpl || DEFAULTS;
  console.log("[Pendora/send] step 1 done, template:", tpl ? "custom" : "defaults");

  // Extract order data
  const customer = order.customer || {};
  const customerName = customer.first_name || customer.default_address?.first_name || "Customer";
  const customerEmail = order.contact_email || order.email || customer.email;
  console.log("[Pendora/send] step 2: customerEmail =", customerEmail);
  if (!customerEmail) {
    console.log("[Pendora] Email skipped — no customer email on order", order.id);
    const orderNum = order.name || `#${order.order_number || order.id}`;
    await sendMerchantAlert({
      shop,
      orderNumber: orderNum,
      customerEmail: null,
      reason: "Order has no customer email address — Pendora couldn't send the download link.",
      errorDetail: null,
    });
    return;
  }

  const orderNumber = order.name || `#${order.order_number || order.id}`;
  const shopName = shop.replace(".myshopify.com", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // No customer email at all → can't even attempt to send. Alert the merchant
  // so they can reach out to the buyer with a resend from the delivery log.
  // (Moved up from the early `return` so the alert fires.)

  // Get product IDs from line items
  const lineProductIds = (order.line_items || [])
    .map((li) => li.product_id)
    .filter(Boolean)
    .map((id) => `gid://shopify/Product/${id}`);
  console.log("[Pendora/send] step 3: lineProductIds =", lineProductIds);

  if (!lineProductIds.length) {
    console.log("[Pendora] Email skipped — no product IDs on order");
    return;
  }

  // Find matching digital files — fetch ALL first so we can distinguish
  // "product is non-digital" (legit skip, no alert) from "product has files
  // but they're broken/disabled" (alert the merchant).
  console.log("[Pendora/send] step 4: querying productFile table");
  const allMatchingFiles = await prisma.productFile.findMany({
    where: { shop, productId: { in: lineProductIds } },
    orderBy: { createdAt: "desc" },
  });
  const files = allMatchingFiles.filter((f) => f.downloadEnabled && f.status === "ready");
  console.log(
    "[Pendora/send] step 4 done, total:", allMatchingFiles.length,
    "deliverable:", files.length,
    "statuses:", allMatchingFiles.map((f) => `${f.status}${f.downloadEnabled ? "" : "-disabled"}`).join(","),
  );

  if (!files.length) {
    if (!allMatchingFiles.length) {
      // Product is not a Pendora digital product. Don't spam the merchant for
      // regular Shopify orders.
      console.log("[Pendora] Email skipped — no Pendora files for order", orderNumber);
      return;
    }
    // Files exist but NONE are deliverable — either all 'failed' uploads or all
    // explicitly disabled. This IS actionable: merchant thought this product
    // would auto-deliver and it didn't.
    const reasons = allMatchingFiles.map((f) => `${f.fileName}: ${f.downloadEnabled ? f.status : "disabled"}`).join("; ");
    console.log("[Pendora] Email skipped — files exist but none deliverable:", reasons);
    await sendMerchantAlert({
      shop,
      orderNumber,
      customerEmail,
      reason: "Product has Pendora files attached, but none are deliverable (failed uploads or manually disabled).",
      errorDetail: reasons,
    });
    return;
  }

  // Group by product, build download URLs. Each URL wraps { fileId, orderId, exp }
  // in an opaque signed token → URL shows /dl/<token> instead of exposing raw fileId
  // and oid. The download route decodes it and applies per-order limit enforcement.
  const tokenExpiry = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const orderIdStr = String(order.id);
  const productMap = {};
  for (const f of files) {
    if (!productMap[f.productId]) {
      productMap[f.productId] = { productTitle: f.productTitle || "Digital Product", files: [] };
    }
    const dl = encodeDeliveryToken({ fileId: f.id, orderId: orderIdStr, expDays: 30 });
    productMap[f.productId].files.push({
      id: f.id,
      fileName: f.fileName,
      displayName: f.displayName || f.fileName,
      fileSize: formatFileSize(f.fileSize),
      downloadUrl: `https://${shop}/apps/pendora/api/dl/${dl}`,
    });
  }
  const products = Object.values(productMap);

  // Render email
  const vars = { customer_name: customerName, customer_email: customerEmail, order_number: orderNumber, shop_name: shopName };
  const subject = replaceVars(template.subject, vars);
  const heading = replaceVars(template.heading, vars);
  const bodyText = replaceVars(template.body, vars);
  const footerText = replaceVars(template.footer, vars);
  const buttonColor = template.buttonColor || DEFAULTS.buttonColor;
  const productsHtml = buildProductsHtml(products, buttonColor);
  const html = buildEmailHtml({ heading, body: bodyText, footer: footerText, productsHtml, shopName, buttonColor });

  // Send via direct MX delivery — no third-party, no passwords.
  // Race against CUSTOMER_EMAIL_TIMEOUT_MS so a stuck SMTP connection doesn't
  // silently leave the customer without their email and the merchant unaware.
  console.log("[Pendora/send] step 5: calling sendMail, to =", customerEmail, "htmlLen =", html.length);
  let sendTimer;
  try {
    await Promise.race([
      sendMail({ from: FROM_EMAIL, fromName: FROM_NAME, to: customerEmail, subject, html }),
      new Promise((_, reject) => {
        sendTimer = setTimeout(
          () => reject(new Error(`Email send timed out after ${CUSTOMER_EMAIL_TIMEOUT_MS / 1000}s`)),
          CUSTOMER_EMAIL_TIMEOUT_MS,
        );
      }),
    ]);
    if (sendTimer) clearTimeout(sendTimer);
    console.log(`[Pendora] Email sent to ${customerEmail} for order ${orderNumber}`);

    for (const [productId, data] of Object.entries(productMap)) {
      await prisma.emailLog.create({
        data: {
          shop, orderId: String(order.id), orderNumber, customerName, customerEmail,
          productId, productTitle: data.productTitle,
          fileIds: JSON.stringify(data.files.map((f) => f.id)),
          status: "sent", tokenExpiry,
        },
      });
    }
  } catch (err) {
    if (sendTimer) clearTimeout(sendTimer);
    console.error(`[Pendora] Email failed for ${customerEmail}:`, err?.message ?? err);
    const displayError = friendlyMailError(err);
    for (const [productId, data] of Object.entries(productMap)) {
      await prisma.emailLog.create({
        data: {
          shop, orderId: String(order.id), orderNumber, customerName, customerEmail,
          productId, productTitle: data.productTitle,
          fileIds: JSON.stringify(data.files.map((f) => f.id)),
          status: "failed", error: displayError, tokenExpiry,
        },
      });
    }
    // Warn the merchant so they can manually resend instead of learning from
    // a support ticket. Alert is best-effort — never rethrows.
    await sendMerchantAlert({
      shop,
      orderNumber,
      customerEmail,
      reason: displayError,
      errorDetail: err?.message ?? String(err),
    });
  }
}
