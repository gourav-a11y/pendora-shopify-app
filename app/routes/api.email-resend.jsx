import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendMail } from "../utils/mailer.server";

function formatFileSize(bytes) {
  if (!bytes) return "";
  const n = Number(bytes);
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const { logId, customMessage, customEmail, specificFileIds } = body;
  if (!logId) return Response.json({ error: "Missing log ID." }, { status: 400 });

  const log = await prisma.emailLog.findUnique({ where: { id: logId } });
  if (!log || log.shop !== shop) return Response.json({ error: "Email record not found." }, { status: 404 });

  const tpl = await prisma.emailTemplate.findUnique({ where: { shop } });
  const template = tpl || {
    subject: "Your digital files from {{shop_name}}",
    heading: "Hi {{customer_name}},",
    body: "Thank you for your order #{{order_number}}! Your digital files are ready to download.",
    footer: "Thanks for shopping with us!",
    buttonColor: "#1B2B44",
  };

  let fileIds;
  try { fileIds = JSON.parse(log.fileIds); } catch { fileIds = []; }
  // If merchant selected specific files, only send those
  const targetIds = specificFileIds?.length ? specificFileIds.filter((id) => fileIds.includes(id)) : fileIds;
  const files = await prisma.productFile.findMany({ where: { id: { in: targetIds }, downloadEnabled: true } });
  if (!files.length) return Response.json({ error: "No downloadable files found." }, { status: 404 });

  const shopName = shop.replace(".myshopify.com", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const vars = { customer_name: log.customerName, customer_email: log.customerEmail, order_number: log.orderNumber, shop_name: shopName };
  const replaceVars = (text) => { let out = text; for (const [key, val] of Object.entries(vars)) out = out.replaceAll(`{{${key}}}`, val || ""); return out; };

  const buttonColor = template.buttonColor || "#1B2B44";
  const cleanName = (name) => (name || "File").replace(/\.[^.]+$/, "").replace(/[-_\.~!@#$%^&*()+=\[\]{}|\\:;"'<>,?/]+/g, " ").replace(/\s+/g, " ").trim() || "File";
  const getExt = (name) => { const ext = (name || "").split(".").pop(); return ext && ext !== name ? ext.toUpperCase() : ""; };

  const fileRows = files.map((f) => {
    const ext = getExt(f.fileName);
    const display = cleanName(f.displayName || f.fileName);
    return `<tr>
    <td style="padding:14px 16px;border-bottom:1px solid #eee">
      <div style="margin-bottom:10px">
        <span style="display:inline-block;background:rgba(245,165,36,0.12);color:#D48A06;font-size:10px;font-weight:800;padding:3px 8px;border-radius:5px;letter-spacing:0.3px;vertical-align:middle;margin-right:8px">${ext}</span>
        <span style="font-size:15px;font-weight:600;color:#303030;vertical-align:middle">${display}</span>
        <span style="font-size:12px;color:#999;vertical-align:middle;margin-left:6px">${formatFileSize(f.fileSize)}</span>
      </div>
      <a href="https://${shop}/apps/pendora/api/download/${f.id}" style="display:inline-block;padding:10px 28px;background:${buttonColor};color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:700">Download</a>
    </td>
  </tr>`;}).join("");

  const productsHtml = `<div style="margin:16px 0;border:1px solid #E1E3E5;border-radius:10px;overflow:hidden">
    <div style="background:#F6F6F7;padding:12px 16px;font-weight:700;font-size:15px;color:#303030;border-bottom:1px solid #E1E3E5">${log.productTitle}</div>
    <table style="width:100%;border-collapse:collapse">${fileRows}</table>
  </div>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F6F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:32px 16px">
  <div style="background:#fff;border-radius:12px;border:1px solid #E1E3E5;overflow:hidden">
    <div style="background:${buttonColor};padding:24px 28px;text-align:center"><div style="color:#fff;font-size:20px;font-weight:800">${shopName}</div></div>
    <div style="padding:28px 28px 12px">
      <div style="margin-bottom:14px"><span style="display:inline-block;background:#E4E5E7;color:#6D7175;font-size:11px;font-weight:700;padding:3px 10px;border-radius:5px;letter-spacing:0.3px">RESENT</span></div>
      <div style="font-size:18px;font-weight:700;color:#303030;margin-bottom:12px">${replaceVars(template.heading)}</div>
      ${customMessage ? `<div style="font-size:15px;color:#303030;line-height:1.7;margin-bottom:16px;padding:12px 16px;background:#F6F6F7;border-radius:8px;border-left:3px solid ${buttonColor}"><strong>Message from store:</strong><br/>${customMessage.replace(/\n/g, "<br/>")}</div>` : ""}
      <div style="font-size:15px;color:#6D7175;line-height:1.7;margin-bottom:20px">${replaceVars(template.body)}</div>
      ${productsHtml}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #E1E3E5;font-size:14px;color:#6D7175;line-height:1.7">${replaceVars(template.footer)}</div>
    </div>
    <div style="padding:16px 28px;background:#F6F6F7;text-align:center;font-size:11px;color:#999">Sent from ${shopName} &middot; Powered by Pendora</div>
  </div>
</div></body></html>`;

  try {
    await sendMail({
      from: "gourav@pumper.run",
      fromName: "Pendora",
      to: customEmail || log.customerEmail,
      subject: replaceVars(template.subject),
      html,
    });

    const tokenExpiry = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await prisma.emailLog.create({
      data: {
        shop, orderId: log.orderId, orderNumber: log.orderNumber,
        customerName: log.customerName, customerEmail: customEmail || log.customerEmail,
        productId: log.productId, productTitle: log.productTitle,
        fileIds: log.fileIds, status: "resent", tokenExpiry,
      },
    });

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: `Send failed: ${err.message}` }, { status: 500 });
  }
};
