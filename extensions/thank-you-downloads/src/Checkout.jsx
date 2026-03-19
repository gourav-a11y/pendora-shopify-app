import {
  reactExtension,
  useAppMetafields,
  useShop,
  BlockStack,
  InlineStack,
  Button,
  Heading,
  Text,
  Divider,
  View,
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
    <BlockStack spacing="base">
      <Divider />
      <BlockStack spacing="extraTight">
        <Heading level={2}>Your Downloads</Heading>
        <Text appearance="subdued">
          {allFiles.length} {allFiles.length === 1 ? "file" : "files"} ready to download
        </Text>
      </BlockStack>
      <BlockStack spacing="tight">
        {allFiles.map((file) => (
          <InlineStack key={file.fileId} spacing="base" blockAlignment="center">
            <View inlineSize="fill">
              <Text size="base" emphasis="bold">{file.displayName}</Text>
            </View>
            <Button
              to={`${proxyBase}/api/download/${file.fileId}`}
              kind="secondary"
            >
              ↓ Download
            </Button>
          </InlineStack>
        ))}
      </BlockStack>
    </BlockStack>
  );
}
