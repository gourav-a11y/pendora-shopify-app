import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * GDPR: Shop redact — delete all data for a shop (48h after uninstall).
 * Shopify requires this for apps accessing protected customer data.
 */
export const action = async ({ request }) => {
  const { shop } = await authenticate.webhook(request);

  // Delete all shop data
  await Promise.all([
    prisma.emailLog.deleteMany({ where: { shop } }),
    prisma.emailTemplate.deleteMany({ where: { shop } }),
    prisma.smtpConfig.deleteMany({ where: { shop } }),
    prisma.productFile.deleteMany({ where: { shop } }),
  ]);

  console.log(`[Pendora] Shop redact completed for ${shop}`);

  return new Response("OK", { status: 200 });
};
