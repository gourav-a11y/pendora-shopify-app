import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * GDPR: Customer data request — return all data we store for this customer.
 * Shopify requires this for apps accessing protected customer data.
 */
export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  const customerEmail = payload?.customer?.email;
  if (!customerEmail) return new Response("OK", { status: 200 });

  // We store customer email only in EmailLog — return what we have
  const logs = await prisma.emailLog.findMany({
    where: { shop, customerEmail },
    select: { id: true, orderNumber: true, customerName: true, customerEmail: true, productTitle: true, status: true, createdAt: true },
  });

  console.log(`[Pendora] Customer data request for ${customerEmail}: ${logs.length} email logs found`);

  return new Response(JSON.stringify({ customer_email: customerEmail, email_logs: logs }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
