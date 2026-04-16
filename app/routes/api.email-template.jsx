import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DEFAULTS = {
  subject: "Your digital files from {{shop_name}}",
  heading: "Hi {{customer_name}},",
  body: "Thank you for your order #{{order_number}}! Your digital files are ready to download.",
  footer: "Thanks for shopping with us!",
  buttonColor: "#1B2B44",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const tpl = await prisma.emailTemplate.findUnique({ where: { shop: session.shop } });
  return Response.json({ template: tpl || DEFAULTS });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const { subject, heading, body: tplBody, footer, buttonColor } = body;

  const data = {
    subject: (subject || DEFAULTS.subject).substring(0, 500),
    heading: (heading || DEFAULTS.heading).substring(0, 300),
    body: (tplBody || DEFAULTS.body).substring(0, 5000),
    footer: (footer || DEFAULTS.footer).substring(0, 1000),
    buttonColor: (buttonColor || DEFAULTS.buttonColor).substring(0, 20),
  };

  await prisma.emailTemplate.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });

  return Response.json({ success: true });
};
