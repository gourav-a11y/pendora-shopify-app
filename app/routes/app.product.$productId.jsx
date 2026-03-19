import { useState, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, useRevalidator, useRouteError, isRouteErrorResponse } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateDownloadToken } from "../utils/token.server";

function formatFileSize(bytes) {
  if (!bytes) return "–";
  const n = Number(bytes);
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const productGid = `gid://shopify/Product/${params.productId}`;

  const [productRes, files] = await Promise.all([
    admin.graphql(
      `#graphql
      query getProduct($id: ID!) {
        product(id: $id) { id title status }
      }`,
      { variables: { id: productGid } }
    ),
    prisma.productFile.findMany({
      where: { shop: session.shop, productId: productGid },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const data = await productRes.json();
  const product = data.data.product;
  if (!product) throw new Response("Product not found", { status: 404 });

  const downloadEnabled = files.length > 0 ? files[0].downloadEnabled : true;

  return {
    product,
    downloadEnabled,
    files: files.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      displayName: f.displayName || f.fileName,
      fileSize: formatFileSize(f.fileSize),
      createdAt: f.createdAt.toISOString(),
      downloadToken: generateDownloadToken(f.id),
    })),
  };
};

// ─── Action ──────────────────────────────────────────────────────────────────

export const action = async ({ request, params }) => {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const productGid = `gid://shopify/Product/${params.productId}`;

    const formData = await request.formData();
    const _action = formData.get("_action");

    if (_action === "delete") {
      const fileId = formData.get("fileId");
      if (!fileId) return { error: "No file ID provided." };
      const file = await prisma.productFile.findFirst({ where: { id: fileId, shop } });
      if (!file) return { error: "File not found." };
      await prisma.productFile.delete({ where: { id: fileId } });
      return { success: "File deleted." };
    }

    if (_action === "toggleDownload") {
      const downloadEnabled = formData.get("downloadEnabled") === "true";
      await prisma.productFile.updateMany({
        where: { shop, productId: productGid },
        data: { downloadEnabled },
      });
      return { successToggle: true };
    }

    return { error: "Unknown action." };
  } catch (err) {
    if (err instanceof Response) throw err;
    return { error: "Action failed: " + err.message };
  }
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProductDetailPage() {
  const { product, files, downloadEnabled: initDL } = useLoaderData();
  const deleteFetcher = useFetcher();
  const toggleFetcher = useFetcher();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const fileInputRef = useRef(null);

  const [displayName, setDisplayName] = useState("");
  const [downloadEnabled, setDownloadEnabled] = useState(initDL);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);

  const isDeleting =
    deleteFetcher.state === "submitting" || deleteFetcher.state === "loading";

  const isBusy = isUploading || isDeleting;

  const handleUpload = async () => {
    if (isBusy) return;
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      // Step 1: Get presigned target
      const stageRes = await fetch("/api/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "stage",
          files: [{ filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size }],
        }),
      });
      const stageData = await stageRes.json();
      if (!stageRes.ok || stageData.error) throw new Error(stageData.error || "Failed to prepare upload.");

      // Step 2: Upload directly to Shopify CDN (bypasses tunnel)
      const target = stageData.targets[0];
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", target.url);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.timeout = 300000;
        xhr.ontimeout = () => reject(new Error("Upload timed out."));
        xhr.onerror = () => reject(new Error("Network error."));
        xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`));
        xhr.send(file);
      });

      // Step 3: Save to DB
      const saveRes = await fetch("/api/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "save",
          files: [{ resourceUrl: target.resourceUrl, filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, displayName: displayName || file.name }],
          productId: product.id,
          productTitle: product.title,
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || saveData.error) throw new Error(saveData.error || "Failed to save file.");

      fileInputRef.current.value = "";
      setDisplayName("");
      setUploadSuccess(`"${file.name}" uploaded successfully.`);
      revalidate(); // refresh file list
    } catch (err) {
      setUploadError(err.message || "Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = (fileId) => {
    if (isBusy) return;
    const fd = new FormData();
    fd.append("_action", "delete");
    fd.append("fileId", fileId);
    deleteFetcher.submit(fd, { method: "POST" });
  };

  const handleToggle = (newVal) => {
    setDownloadEnabled(newVal); // optimistic
    const fd = new FormData();
    fd.append("_action", "toggleDownload");
    fd.append("downloadEnabled", String(newVal));
    toggleFetcher.submit(fd, { method: "POST" });
  };

  return (
    <s-page heading={product.title}>
      {/* Back — locked while busy */}
      <div style={{ marginBottom: "20px" }}>
        <s-button
          variant="tertiary"
          disabled={isBusy}
          onClick={() => !isBusy && navigate("/app/products")}
        >
          ← Back to Digital Products
        </s-button>
      </div>

      {/* ── Upload in progress banner ── */}
      {isUploading && (
        <div style={{ padding: "12px 16px", marginBottom: "16px", background: "#f1f8f5", border: "1px solid #95c9b4", borderRadius: "8px", color: "#008060", fontWeight: 500, display: "flex", alignItems: "center", gap: "10px" }}>
          <span>⏳</span> Uploading file... Please wait and do not leave this page.
        </div>
      )}

      {/* ── Download Toggle ── */}
      <s-section heading="Thank You Page Settings">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
          <div>
            <div style={{ fontWeight: 500 }}>Enable download on Thank You page</div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "2px" }}>
              Customers will see a Download button after purchasing this product.
            </div>
          </div>
          <div
            onClick={() => handleToggle(!downloadEnabled)}
            style={{ width: "48px", height: "28px", borderRadius: "14px", background: downloadEnabled ? "#008060" : "#c9cccf", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.2s" }}
          >
            <div style={{ position: "absolute", top: "3px", left: downloadEnabled ? "23px" : "3px", width: "22px", height: "22px", borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
          </div>
        </div>
      </s-section>

      {/* ── Upload Section ── */}
      <s-section heading="Upload File">
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>Select File</label>
            <input
              ref={fileInputRef}
              type="file"
              disabled={isBusy}
              accept=".pdf,.zip,.mp3,.mp4,.png,.jpg,.jpeg,.gif,.webp,.mov,.epub,.docx,.xlsx"
              style={{ opacity: isBusy ? 0.5 : 1 }}
            />
            <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>
              Max 5 GB — PDF, ZIP, MP3, MP4, PNG, JPG, GIF, EPUB, DOCX, XLSX
            </div>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>Display Name (optional)</label>
            <input
              type="text"
              value={displayName}
              disabled={isBusy}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. User Guide PDF"
              style={{ padding: "6px 10px", border: "1px solid #c9cccf", borderRadius: "6px", width: "300px", opacity: isBusy ? 0.5 : 1 }}
            />
          </div>
          <div>
            <s-button
              disabled={isBusy}
              onClick={handleUpload}
              {...(isUploading ? { loading: true } : {})}
            >
              {isUploading ? "Uploading..." : "Upload File"}
            </s-button>
          </div>

          {uploadError && (
            <div style={{ padding: "10px 14px", background: "#fff4f4", border: "1px solid #ffa8a8", borderRadius: "6px", color: "#d72c0d" }}>
              {uploadError}
            </div>
          )}
          {uploadSuccess && (
            <div style={{ padding: "10px 14px", background: "#f1f8f5", border: "1px solid #95c9b4", borderRadius: "6px", color: "#008060" }}>
              {uploadSuccess}
            </div>
          )}
        </div>
      </s-section>

      {/* ── Files List ── */}
      <s-section heading={`Attached Files (${files.length})`}>
        {deleteFetcher.data?.error && (
          <div style={{ padding: "10px 14px", marginBottom: "12px", background: "#fff4f4", border: "1px solid #ffa8a8", borderRadius: "6px", color: "#d72c0d" }}>
            {deleteFetcher.data.error}
          </div>
        )}

        {files.length === 0 ? (
          <s-paragraph>No files attached yet. Upload one above.</s-paragraph>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {files.map((file) => (
              <div key={file.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", border: "1px solid #e1e3e5", borderRadius: "8px", background: "#fafafa", opacity: isBusy ? 0.6 : 1 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontWeight: 500 }}>{file.displayName}</span>
                  {file.displayName !== file.fileName && (
                    <span style={{ fontSize: "12px", color: "#6d7175" }}>{file.fileName}</span>
                  )}
                  <span style={{ fontSize: "12px", color: "#6d7175" }}>
                    {file.fileSize} · {new Date(file.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <a href={`/api/files/${file.id}?token=${file.downloadToken}`} target="_blank" rel="noreferrer">
                    <s-button variant="secondary" disabled={isBusy}>Download</s-button>
                  </a>
                  <s-button
                    variant="danger"
                    disabled={isBusy}
                    onClick={() => handleDelete(file.id)}
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </s-button>
                </div>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const statusCode = isRouteErrorResponse(error) ? error.status : null;
  const message = isRouteErrorResponse(error)
    ? (error.data?.message || error.statusText || "An error occurred.")
    : error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <s-page heading="Something went wrong">
      <s-section>
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          {statusCode && <p style={{ fontSize: "48px", fontWeight: 700, color: "#d72c0d", margin: "0 0 8px 0" }}>{statusCode}</p>}
          <p style={{ color: "#6d7175", marginBottom: "24px" }}>{message}</p>
          <s-button onClick={() => window.history.back()}>← Go Back</s-button>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
