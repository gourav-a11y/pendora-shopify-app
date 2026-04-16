import {
  reactExtension,
  useAppMetafields,
  useShop,
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
                  to={`${proxyBase}/api/download/${file.fileId}`}
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
