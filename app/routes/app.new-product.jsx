import { useState, useRef } from "react";
import { useLoaderData, useNavigate, useRouteError, isRouteErrorResponse } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);

    // Fetch all Shopify products
    const response = await admin.graphql(`
      #graphql
      query getProducts {
        products(first: 100, sortKey: TITLE) {
          edges {
            node { id title status featuredImage { url } }
          }
        }
      }
    `);
    const data = await response.json();
    const products = data.data.products.edges.map((e) => e.node);

    // Fetch productIds that already have digital products
    const existing = await prisma.productFile.findMany({
      where: { shop: session.shop },
      distinct: ["productId"],
      select: { productId: true },
    });
    const existingProductIds = new Set(existing.map((e) => e.productId));

    // Attach numericId for routing
    const productsWithStatus = products.map((p) => ({
      ...p,
      numericId: p.id.replace("gid://shopify/Product/", ""),
      alreadyCreated: existingProductIds.has(p.id),
    }));

    return { products: productsWithStatus };
  } catch (err) {
    if (err instanceof Response) throw err;
    throw new Response(err.message || "Failed to load products.", { status: 500 });
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STEP_LABELS = ["Select Product", "Upload Files", "Settings"];

// ─── Component ───────────────────────────────────────────────────────────────

export default function NewProductPage() {
  const { products } = useLoaderData();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [step, setStep] = useState(1);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [downloadEnabled, setDownloadEnabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const filteredProducts = products.filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleFilePick = (e) => {
    if (isSubmitting) return;
    const newFiles = Array.from(e.target.files || []);
    setPendingFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...newFiles.filter((f) => !existing.has(f.name + f.size))];
    });
    e.target.value = "";
  };

  const removeFile = (index) => {
    if (isSubmitting) return;
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const goToStep = (target) => {
    if (isSubmitting) return;
    setStep(target);
  };

  const handleSubmit = async () => {
    if (isSubmitting || pendingFiles.length === 0 || !selectedProduct) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      // Step 1: Get presigned upload targets (small JSON → no tunnel issues)
      const stageRes = await fetch("/api/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "stage",
          files: pendingFiles.map((f) => ({
            filename: f.name,
            mimeType: f.type || "application/octet-stream",
            fileSize: f.size,
          })),
        }),
      });
      const stageData = await stageRes.json();
      if (!stageRes.ok || stageData.error) throw new Error(stageData.error || "Failed to prepare upload.");

      // Step 2: Upload each file DIRECTLY to Shopify CDN (browser → CDN, bypasses tunnel)
      const uploadedFiles = [];
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        const target = stageData.targets[i];
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", target.url);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.timeout = 300000;
          xhr.ontimeout = () => reject(new Error(`Timed out uploading "${file.name}".`));
          xhr.onerror = () => reject(new Error(`Network error uploading "${file.name}".`));
          xhr.onload = () => {
            if (xhr.status < 300) resolve();
            else reject(new Error(`Upload failed for "${file.name}" (${xhr.status}).`));
          };
          xhr.send(file);
        });
        uploadedFiles.push({
          resourceUrl: target.resourceUrl,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          displayName: file.name,
        });
      }

      // Step 3: Register on Shopify + save to DB (small JSON → no tunnel issues)
      const saveRes = await fetch("/api/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "save",
          files: uploadedFiles,
          productId: selectedProduct.id,
          productTitle: selectedProduct.title,
          downloadEnabled,
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || saveData.error) throw new Error(saveData.error || "Failed to save files.");

      window.location.href = "/app/products";
    } catch (err) {
      setSubmitError(err.message || "Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <s-page heading="Create Digital Product">
      {/* Back — locked during submission */}
      <div style={{ marginBottom: "20px" }}>
        <s-button
          variant="tertiary"
          disabled={isSubmitting}
          onClick={() => !isSubmitting && navigate("/app/products")}
        >
          ← Back
        </s-button>
      </div>

      {/* ── Step Indicator ── */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: "28px" }}>
        {STEP_LABELS.map((label, i) => {
          const num = i + 1;
          const isActive = step === num;
          const isDone = step > num;
          return (
            <div key={num} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                <div style={{
                  width: "32px", height: "32px", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: "14px",
                  background: isDone ? "#008060" : isActive ? "#1a1a1a" : "#e1e3e5",
                  color: isDone || isActive ? "#fff" : "#6d7175",
                  cursor: isDone && !isSubmitting ? "pointer" : "default",
                  opacity: isSubmitting && !isActive ? 0.5 : 1,
                }}>
                  {isDone ? "✓" : num}
                </div>
                <span style={{ fontSize: "12px", marginTop: "4px", color: isActive ? "#1a1a1a" : "#6d7175", fontWeight: isActive ? 600 : 400 }}>
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div style={{ flex: 2, height: "2px", background: step > num ? "#008060" : "#e1e3e5", marginBottom: "18px" }} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Step 1: Select Product ── */}
      {step === 1 && (
        <s-section heading="Select a product">
          <div style={{ marginBottom: "12px" }}>
            <input
              type="text"
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", maxWidth: "400px", padding: "8px 12px", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "14px", boxSizing: "border-box" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "400px", overflowY: "auto" }}>
            {filteredProducts.length === 0 ? (
              <div style={{ color: "#6d7175", padding: "16px 0" }}>No products found.</div>
            ) : filteredProducts.map((product) => {
              const isSelected = selectedProduct?.id === product.id;
              const already = product.alreadyCreated;
              return (
                <div
                  key={product.id}
                  onClick={() => {
                    if (already) {
                      navigate("/app/products");
                    } else {
                      setSelectedProduct(product);
                    }
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    padding: "12px 14px",
                    border: `2px solid ${isSelected ? "#008060" : already ? "#c9cccf" : "#e1e3e5"}`,
                    borderRadius: "8px",
                    background: isSelected ? "#f1f8f5" : already ? "#f9fafb" : "#fff",
                    cursor: "pointer",
                    opacity: already ? 0.75 : 1,
                  }}
                >
                  {product.featuredImage?.url ? (
                    <img src={product.featuredImage.url} alt={product.title} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "4px" }} />
                  ) : (
                    <div style={{ width: "40px", height: "40px", background: "#f0f0f0", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>📦</div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{product.title}</div>
                    <div style={{ fontSize: "12px", color: "#6d7175", textTransform: "capitalize" }}>{product.status.toLowerCase()}</div>
                  </div>
                  {already ? (
                    <span style={{ fontSize: "12px", background: "#e3f1df", color: "#2a7f45", padding: "2px 10px", borderRadius: "12px", border: "1px solid #a2d1ae", fontWeight: 500, whiteSpace: "nowrap" }}>
                      Already created — Manage →
                    </span>
                  ) : isSelected ? (
                    <div style={{ color: "#008060", fontWeight: 700, fontSize: "18px" }}>✓</div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: "20px" }}>
            <s-button
              variant="primary"
              disabled={!selectedProduct || selectedProduct.alreadyCreated}
              onClick={() => selectedProduct && !selectedProduct.alreadyCreated && goToStep(2)}
            >
              Next: Upload Files →
            </s-button>
          </div>
        </s-section>
      )}

      {/* ── Step 2: Upload Files ── */}
      {step === 2 && (
        <s-section heading={`Upload files for "${selectedProduct?.title}"`}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={handleFilePick}
              />
              <s-button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                + Add Files
              </s-button>
              <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "6px" }}>
                Max 100MB per file — PDF, ZIP, MP3, MP4, PNG, JPG, GIF, EPUB, DOCX, XLSX
              </div>
            </div>

            {pendingFiles.length === 0 ? (
              <div style={{ padding: "32px", border: "2px dashed #e1e3e5", borderRadius: "8px", textAlign: "center", color: "#6d7175" }}>
                No files selected. Click "+ Add Files" to choose.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {pendingFiles.map((file, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", border: "1px solid #e1e3e5", borderRadius: "6px", background: "#fafafa" }}>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: "14px" }}>{file.name}</div>
                      <div style={{ fontSize: "12px", color: "#6d7175" }}>{formatFileSize(file.size)}</div>
                    </div>
                    <button
                      onClick={() => removeFile(i)}
                      style={{ background: "none", border: "none", color: "#6d7175", cursor: "pointer", fontSize: "20px", padding: "0 4px", lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: "10px" }}>
              <s-button variant="tertiary" onClick={() => goToStep(1)}>← Back</s-button>
              <s-button
                variant="primary"
                disabled={pendingFiles.length === 0}
                onClick={() => pendingFiles.length > 0 && goToStep(3)}
              >
                Next: Settings →
              </s-button>
            </div>
          </div>
        </s-section>
      )}

      {/* ── Step 3: Settings + Submit ── */}
      {step === 3 && (
        <s-section heading="Settings">
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

            {/* Loading overlay message */}
            {isSubmitting && (
              <div style={{ padding: "14px 16px", background: "#f1f8f5", border: "1px solid #95c9b4", borderRadius: "8px", color: "#008060", fontWeight: 500, display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "18px" }}>⏳</span>
                Uploading files and saving... Please do not go back or close this page.
              </div>
            )}

            {/* Summary */}
            <div style={{ padding: "14px 16px", background: "#f9fafb", border: "1px solid #e1e3e5", borderRadius: "8px", opacity: isSubmitting ? 0.6 : 1 }}>
              <div style={{ fontWeight: 600, marginBottom: "8px" }}>Summary</div>
              <div style={{ fontSize: "14px", marginBottom: "4px" }}>
                <span style={{ color: "#6d7175" }}>Product: </span>
                <span style={{ fontWeight: 500 }}>{selectedProduct?.title}</span>
              </div>
              <div style={{ fontSize: "14px" }}>
                <span style={{ color: "#6d7175" }}>Files ({pendingFiles.length}): </span>
                <span style={{ fontWeight: 500 }}>{pendingFiles.map((f) => f.name).join(", ")}</span>
              </div>
            </div>

            {/* Download toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", border: "1px solid #e1e3e5", borderRadius: "8px", opacity: isSubmitting ? 0.6 : 1 }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: "15px" }}>Enable download on Thank You page</div>
                <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "2px" }}>
                  Customers see a Download button after purchasing this product.
                </div>
              </div>
              <div
                onClick={() => !isSubmitting && setDownloadEnabled((v) => !v)}
                style={{
                  width: "48px", height: "28px", borderRadius: "14px",
                  background: downloadEnabled ? "#008060" : "#c9cccf",
                  position: "relative", cursor: isSubmitting ? "not-allowed" : "pointer",
                  flexShrink: 0, marginLeft: "16px", transition: "background 0.2s",
                }}
              >
                <div style={{ position: "absolute", top: "3px", left: downloadEnabled ? "23px" : "3px", width: "22px", height: "22px", borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
              </div>
            </div>

            {/* Error */}
            {submitError && (
              <div style={{ padding: "10px 14px", background: "#fff4f4", border: "1px solid #ffa8a8", borderRadius: "6px", color: "#d72c0d" }}>
                {submitError}
              </div>
            )}

            {/* Actions — locked during submit */}
            <div style={{ display: "flex", gap: "10px" }}>
              <s-button
                variant="tertiary"
                disabled={isSubmitting}
                onClick={() => goToStep(2)}
              >
                ← Back
              </s-button>
              <s-button
                variant="primary"
                disabled={isSubmitting}
                onClick={handleSubmit}
                {...(isSubmitting ? { loading: true } : {})}
              >
                {isSubmitting ? "Uploading & Saving..." : "Create Digital Product"}
              </s-button>
            </div>
          </div>
        </s-section>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  let statusCode = isRouteErrorResponse(error) ? error.status : null;
  let message = isRouteErrorResponse(error)
    ? (error.data?.message || error.statusText || "An error occurred.")
    : error instanceof Error ? error.message : "An unexpected error occurred.";

  return (
    <s-page heading="Something went wrong">
      <s-section>
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          {statusCode && (
            <p style={{ fontSize: "48px", fontWeight: 700, color: "#d72c0d", margin: "0 0 8px 0" }}>
              {statusCode}
            </p>
          )}
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
