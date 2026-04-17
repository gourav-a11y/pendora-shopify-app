import prisma from "../db.server";
import { generateEmailDownloadToken } from "./token.server";
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
  const tpl = await prisma.emailTemplate.findUnique({ where: { shop } });
  const template = tpl || DEFAULTS;

  // Extract order data
  const customer = order.customer || {};
  const customerName = customer.first_name || customer.default_address?.first_name || "Customer";
  const customerEmail = order.contact_email || order.email || customer.email;
  if (!customerEmail) {
    console.log("[Pendora] Email skipped — no customer email on order", order.id);
    return;
  }

  const orderNumber = order.name || `#${order.order_number || order.id}`;
  const shopName = shop.replace(".myshopify.com", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Get product IDs from line items
  const lineProductIds = (order.line_items || [])
    .map((li) => li.product_id)
    .filter(Boolean)
    .map((id) => `gid://shopify/Product/${id}`);

  if (!lineProductIds.length) return;

  // Find matching digital files
  const files = await prisma.productFile.findMany({
    where: { shop, productId: { in: lineProductIds }, downloadEnabled: true },
    orderBy: { createdAt: "desc" },
  });

  if (!files.length) {
    console.log("[Pendora] Email skipped — no digital files for order", orderNumber);
    return;
  }

  // Group by product, build download URLs
  const tokenExpiry = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const productMap = {};
  for (const f of files) {
    if (!productMap[f.productId]) {
      productMap[f.productId] = { productTitle: f.productTitle || "Digital Product", files: [] };
    }
    productMap[f.productId].files.push({
      id: f.id,
      fileName: f.fileName,
      displayName: f.displayName || f.fileName,
      fileSize: formatFileSize(f.fileSize),
      downloadUrl: `https://${shop}/apps/pendora/api/download/${f.id}`,
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

  // Send via direct MX delivery — no third-party, no passwords
  try {
    await sendMail({
      from: FROM_EMAIL,
      fromName: FROM_NAME,
      to: customerEmail,
      subject,
      html,
    });
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
  }
}
