import {
  reactExtension,
  useAppMetafields,
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

  const triggerDownload = (fileUrl, displayName) => {
    fetch(fileUrl)
      .then((res) => res.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = displayName || "download";
        a.click();
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {
        // fallback: open directly (browser handles it)
        window.open(fileUrl, "_self");
      });
  };

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
              kind="primary"
              onPress={() => triggerDownload(file.fileUrl, file.displayName)}
            >
              ↓ Download your file
            </Button>
          </BlockStack>
        ))}
      </BlockStack>
    </BlockStack>
  );
}
