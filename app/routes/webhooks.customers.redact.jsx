import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * GDPR: Customer redact — delete all customer data we store.
 * Shopify requires this for apps accessing protected customer data.
 */
export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  const customerEmail = payload?.customer?.email;
  if (!customerEmail) return new Response("OK", { status: 200 });

  // Delete all email logs for this customer
  const result = await prisma.emailLog.deleteMany({
    where: { shop, customerEmail },
  });

  console.log(`[Pendora] Customer redact for ${customerEmail}: deleted ${result.count} email logs`);

  return new Response("OK", { status: 200 });
};
