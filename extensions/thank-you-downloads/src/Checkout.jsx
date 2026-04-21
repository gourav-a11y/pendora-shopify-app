import {
  reactExtension,
  useAppMetafields,
  useShop,
  useApi,
  useSubscription,
  BlockStack,
  InlineStack,
  InlineLayout,
  Button,
  Heading,
  Text,
  Divider,
  View,
  Badge,
  BlockSpacer,
} from "@shopify/ui-extensions-react/checkout";

export default reactExtension(
  "purchase.thank-you.block.render",
  () => <ThankYouDownloads />
);

// Stable stub for useSubscription when the target doesn't expose `orderConfirmation`.
// Keeps useSubscription's dep array stable and keeps the component rendering.
const NULL_CONFIRMATION_SUB = { current: null, subscribe: () => () => {} };

function cleanFileName(name) {
  if (!name) return "File";
  const noExt = name.replace(/\.[^.]+$/, "");
  return noExt.replace(/[-_\.~!@#$%^&*()+=\[\]{}|\\:;"'<>,?/]+/g, " ").replace(/\s+/g, " ").trim() || "File";
}

function getFileExt(name) {
  if (!name) return "";
  const ext = name.split(".").pop();
  return ext && ext !== name ? ext.toUpperCase() : "";
}

function ThankYouDownloads() {
  const { myshopifyDomain } = useShop();
  const metafields = useAppMetafields({ namespace: "pendora", key: "files" }) || [];
  // Scope per-order download limit to this order. purchase.thank-you.block.render
  // exposes OrderConfirmationApi with `orderConfirmation`; we pull the order GID
  // and extract the numeric tail so it matches what the webhook stored in EmailLog.
  // Defensive fallback via NULL_CONFIRMATION_SUB keeps the component from crashing
  // if the API surface ever changes.
  const api = useApi();
  const confirmationSub = ("orderConfirmation" in api && api.orderConfirmation)
    ? api.orderConfirmation
    : NULL_CONFIRMATION_SUB;
  const confirmation = useSubscription(confirmationSub);
  const orderId = confirmation?.order?.id ? String(confirmation.order.id).split("/").pop() : null;

  const allFiles = metafields.flatMap((entry) => {
    const raw = entry?.metafield?.value;
    if (!raw) return [];
    try {
      const files = JSON.parse(raw);
      if (!Array.isArray(files)) return [];
      // Drop malformed entries so we never render a button with an undefined fileId.
      return files.filter((f) => f && typeof f.fileId === "string" && f.fileId);
    } catch {
      return [];
    }
  });

  if (!allFiles.length) return null;

  const proxyBase = `https://${myshopifyDomain}/apps/pendora`;

  return (
    <BlockStack spacing="base">
      <Divider />
      <BlockSpacer spacing="tight" />
      <BlockStack spacing="extraTight">
        <Heading level={2}>Your Downloads</Heading>
        <Text appearance="subdued" size="small">
          {allFiles.length} {allFiles.length === 1 ? "file" : "files"} ready to download
        </Text>
      </BlockStack>
      <BlockSpacer spacing="extraTight" />
      <BlockStack spacing="tight">
        {allFiles.map((file) => {
          const ext = getFileExt(file.displayName);
          const name = cleanFileName(file.displayName);
          return (
            <View
              key={file.fileId}
              border="base"
              borderRadius="base"
              padding="base"
            >
              <InlineLayout columns={["fill", "auto"]} blockAlignment="center" spacing="base">
                <BlockStack spacing="extraTight">
                  <InlineStack spacing="tight" blockAlignment="center">
                    {ext && <Badge tone="warning">{ext}</Badge>}
                    <Text size="base" emphasis="bold">{name}</Text>
                  </InlineStack>
                  <Text size="small" emphasis="bold" appearance="subdued">
                    Your file is ready to download
                  </Text>
                </BlockStack>
                <Button
                  to={`${proxyBase}/api/download/${file.fileId}${orderId ? `?oid=${orderId}` : ""}`}
                  kind="primary"
                  accessibilityLabel={`Download ${name}`}
                >
                  Download
                </Button>
              </InlineLayout>
            </View>
          );
        })}
      </BlockStack>
    </BlockStack>
  );
}
