import { authenticate } from "../shopify.server";
import { sendOrderEmail } from "../utils/email.server";

export const action = async ({ request }) => {
  const { shop, payload } = await authenticate.webhook(request);

  console.log(`[Pendora] orders/paid webhook for ${shop}, order ${payload?.name || payload?.id}`);

  // Fire-and-forget — webhook must respond within 5s
  sendOrderEmail(shop, payload).catch((err) =>
    console.error("[Pendora] Email send error:", err?.message ?? err)
  );

  return new Response("OK", { status: 200 });
};
