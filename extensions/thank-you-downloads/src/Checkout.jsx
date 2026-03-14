import {
  reactExtension,
  useAppMetafields,
  useShop,
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

  // Reads product metafields written by the app on file upload — no HTTP needed.
  const metafields = useAppMetafields({ namespace: "pendora", key: "files" });

  const allFiles = metafields.flatMap((entry) => {
    try {
      const files = JSON.parse(entry.metafield.value);
      return Array.isArray(files) ? files : [];
    } catch {
      return [];
    }
  });

  if (!allFiles.length) return null;

  // App proxy URL — stable, routes to current backend regardless of tunnel restarts.
  const proxyBase = `https://${myshopifyDomain}/apps/pendora`;

  return (
    <BlockStack spacing="loose">
      <Divider />
      <Heading level={2}>Your Downloads</Heading>
      <Text appearance="subdued">
        Your digital files are ready. Click below to download.
      </Text>
      <BlockStack spacing="tight">
        {allFiles.map((file) => (
          <Button
            key={file.fileId}
            to={`${proxyBase}/api/download/${file.fileId}`}
            kind="secondary"
          >
            ↓ {file.displayName}
          </Button>
        ))}
      </BlockStack>
    </BlockStack>
  );
}
