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

  const proxyBase = `https://${myshopifyDomain}/apps/pendora`;

  return (
    <BlockStack spacing="loose">
      <Divider />
      <Heading level={2}>Pendora Digital Downloads</Heading>
      <BlockStack spacing="base">
        {allFiles.map((file) => (
          <BlockStack key={file.fileId} spacing="tight">
            <Text appearance="subdued">
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
    </BlockStack>
  );
}
