/**
 * Centralized "pendora.files" metafield sync.
 *
 * Every place that mutates a product's file list (upload, delete, replace,
 * clone) needs to push the updated list to Shopify so the checkout extension
 * can read it via useAppMetafields. This module owns that transformation and
 * the error handling around it — so we log silent GraphQL userErrors instead
 * of swallowing them.
 */

function firstChunkUrlSafe(chunkUrlsJson) {
  if (!chunkUrlsJson) return null;
  try {
    const arr = JSON.parse(chunkUrlsJson);
    return Array.isArray(arr) && arr.length ? arr[0] : null;
  } catch {
    return null;
  }
}

/**
 * Build the files-array payload from DB records.
 * Accepts either ProductFile records or pre-shaped { fileId, displayName, fileUrl } objects.
 */
export function buildFilesPayload(records) {
  return (records || []).map((f) => {
    // Pre-shaped object (fileId already set) — trust it.
    if (f.fileId) {
      return {
        fileId: f.fileId,
        displayName: f.displayName || f.fileName || "File",
        fileUrl: f.fileUrl ?? null,
      };
    }
    // Raw ProductFile DB record
    return {
      fileId: f.id,
      displayName: f.displayName || f.fileName || "File",
      fileUrl: f.fileUrl || firstChunkUrlSafe(f.chunkUrls) || null,
    };
  });
}

/**
 * Push the list of files to the product's pendora.files metafield.
 * Always resolves (never throws) — returns { ok, userErrors, error? } so
 * callers can log without extra try/catch. Errors and userErrors are logged
 * server-side so silent drift is observable.
 */
export async function syncProductFilesMetafield(admin, productId, files) {
  const value = JSON.stringify(files || []);
  try {
    const res = await admin.graphql(
      `#graphql
      mutation SyncPendoraFiles($m: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $m) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          m: [{ ownerId: productId, namespace: "pendora", key: "files", type: "json", value }],
        },
      }
    );
    const data = await res.json();
    const errs = data?.data?.metafieldsSet?.userErrors;
    if (errs?.length) {
      console.warn(`[Pendora] Metafield sync userErrors for ${productId}:`, errs);
      return { ok: false, userErrors: errs };
    }
    return { ok: true, userErrors: [] };
  } catch (err) {
    console.error(`[Pendora] Metafield sync failed for ${productId}:`, err?.message ?? err);
    return { ok: false, userErrors: [], error: err?.message };
  }
}
