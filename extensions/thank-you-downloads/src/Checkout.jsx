import {
  reactExtension,
  useAppMetafields,
  useShop,
  useOrder,
  BlockStack,
  Button,
  Heading,
  Text,
  Divider,
} from "@shopify/ui-extensions-react/checkout";

export default reactExtension(
  "purchase.thank-you.block.render",
  () => <ThankYouDownloads />
);

function ThankYouDownloads() {
  const { myshopifyDomain } = useShop();
  const order = useOrder();
  const metafields = useAppMetafields({ namespace: "pendora", key: "files" });

  // Build productId → title map from order line items
  const productTitleMap = {};
  order?.lineItems?.forEach((item) => {
    const pid = item.variant?.product?.id;
    if (pid) productTitleMap[pid] = item.title;
  });

  // App proxy URL — stable regardless of tunnel restarts
  const proxyBase = `https://${myshopifyDomain}/apps/pendora`;

  // Group files by product
  const groups = metafields
    .map((entry) => {
      let files = [];
      try {
        const parsed = JSON.parse(entry.metafield.value);
        files = Array.isArray(parsed) ? parsed : [];
      } catch {
        // ignore malformed JSON
      }
      const productGid = entry.target?.id ?? "";
      const productTitle = productTitleMap[productGid] || "Your Purchase";
      return { productTitle, files };
    })
    .filter((g) => g.files.length > 0);

  if (!groups.length) return null;

  return (
    <BlockStack spacing="loose">
      <Divider />
      <Heading level={2}>Pendora Digital Downloads</Heading>
      {groups.map((group, gi) => (
        <BlockStack key={gi} spacing="base">
          <Text appearance="subdued" size="base">
            {group.productTitle}
          </Text>
          {group.files.map((file) => (
            <BlockStack key={file.fileId} spacing="tight">
              <Text>
                Your file &quot;{file.displayName}&quot; is ready to download
              </Text>
              <Button
                to={`${proxyBase}/api/download/${file.fileId}`}
                kind="primary"
              >
                ↓ Download your file
              </Button>
            </BlockStack>
          ))}
        </BlockStack>
      ))}
    </BlockStack>
  );
}
