import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <style>{`
        html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }
        html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
        *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
        * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
        html.pendora-modal-open, html.pendora-modal-open body { overflow: hidden !important; }
        html.pendora-modal-open .pendora-noscroll { overflow: hidden !important; }
      `}</style>
      <s-app-nav>
        <s-link href="/app/digital-products">Digital Products</s-link>
        <s-link href="/app/files">Files</s-link>
        <s-link href="/app/email">Email & Deliverables</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
