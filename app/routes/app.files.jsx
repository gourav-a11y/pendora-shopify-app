import { useState, useRef, useEffect } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

function formatFileSize(bytes) {
  if (!bytes) return "–";
  const n = Number(bytes);
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function getFileType(fn) {
  if (!fn) return "OTHER";
  const ext = fn.split(".").pop()?.toLowerCase();
  return ext && ext !== fn.toLowerCase() ? ext.toUpperCase() : "OTHER";
}

function getTypeCategory(fn) {
  const ext = (fn || "").split(".").pop()?.toLowerCase();
  if (["pdf", "epub", "docx", "xlsx"].includes(ext)) return "document";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "mov"].includes(ext)) return "video";
  if (["mp3"].includes(ext)) return "audio";
  if (["zip"].includes(ext)) return "archive";
  return "other";
}

const TI = {
  document: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  image: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  video: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>,
  audio: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
  archive: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
  other: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>,
};

const C = {
  bg: "#F6F6F7", surface: "#FFFFFF", border: "#E1E3E5", text: "#303030",
  muted: "#6D7175", faint: "#999EA3", accent: "#F5A524", navy: "#1B2B44",
  danger: "#D72C0D", dangerBg: "#FFF4F4", dangerBdr: "#FDBDBD",
  success: "#008060", successBg: "#F1F8F5", successBdr: "#AEE9D1",
  shadow: "0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)",
  pill: "rgba(27,43,68,0.07)",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const rawFiles = await prisma.productFile.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });

  const fileGroups = {};
  for (const f of rawFiles) {
    const key = f.fileUrl || `${f.fileName}_${f.fileSize}`;
    if (!fileGroups[key]) {
      fileGroups[key] = {
        key, fileName: f.fileName, displayName: f.displayName || f.fileName,
        fileSize: formatFileSize(f.fileSize), fileSizeRaw: Number(f.fileSize || 0),
        mimeType: f.mimeType, status: f.status || "ready",
        createdAt: f.createdAt.toISOString(), products: [],
      };
    }
    fileGroups[key].products.push({ recordId: f.id, productId: f.productId, productTitle: f.productTitle || "Unknown Product" });
  }

  const files = Object.values(fileGroups);
  let totalSize = 0;
  const typeSizes = {};
  for (const f of files) { totalSize += f.fileSizeRaw; const cat = getTypeCategory(f.fileName); typeSizes[cat] = (typeSizes[cat] || 0) + f.fileSizeRaw; }

  return {
    files, totalFiles: files.length, totalSize: formatFileSize(totalSize),
    typeSizes: Object.entries(typeSizes).map(([cat, size]) => ({ cat, size: formatFileSize(size) })),
  };
};

// ── Smooth accordion height helper ──
function AccordionPanel({ open, children }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(0);
  useEffect(() => { if (ref.current) setHeight(ref.current.scrollHeight); });
  return (
    <div style={{ maxHeight: open ? height : 0, overflow: "hidden", transition: "max-height 0.3s ease" }}>
      <div ref={ref}>{children}</div>
    </div>
  );
}

export default function FilesPage() {
  const { files: allFiles, totalFiles, totalSize, typeSizes } = useLoaderData();
  const actionFetcher = useFetcher();
  const navigate = useNavigate();
  const replaceInputRef = useRef(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [expandedKey, setExpandedKey] = useState(null);
  const [popup, setPopup] = useState(null);
  const [replaceUploading, setReplaceUploading] = useState(false);
  const [replaceProgress, setReplaceProgress] = useState(0);
  const [deletedKeys, setDeletedKeys] = useState(new Set());
  const [feedback, setFeedback] = useState(null);

  let filtered = allFiles.filter((f) => !deletedKeys.has(f.key));
  if (search) filtered = filtered.filter((f) => f.fileName.toLowerCase().includes(search.toLowerCase()));
  if (typeFilter !== "all") filtered = filtered.filter((f) => getTypeCategory(f.fileName) === typeFilter);
  if (sortBy === "name") filtered.sort((a, b) => a.fileName.localeCompare(b.fileName));
  else if (sortBy === "size") filtered.sort((a, b) => b.fileSizeRaw - a.fileSizeRaw);
  else if (sortBy === "type") filtered.sort((a, b) => getFileType(a.fileName).localeCompare(getFileType(b.fileName)));

  const showFeedback = (msg, isError) => { setFeedback({ msg, isError }); setTimeout(() => setFeedback(null), 4000); };

  const onDeleteClick = (file) => {
    if (file.products.length === 1) setPopup({ type: "delete", file, selectedProduct: file.products[0] });
    else setPopup({ type: "delete", file, selectedProduct: null });
  };

  const confirmDelete = () => {
    if (!popup?.selectedProduct) return;
    actionFetcher.submit(JSON.stringify({ _action: "delete", fileId: popup.selectedProduct.recordId }), { method: "POST", action: "/api/file-actions", encType: "application/json" });
    if (popup.file.products.length === 1) setDeletedKeys((p) => { const n = new Set(p); n.add(popup.file.key); return n; });
    showFeedback(`File removed from ${popup.selectedProduct.productTitle}`, false);
    setPopup(null);
    setTimeout(() => navigate(".", { replace: true }), 500);
  };

  const onReplaceClick = (file) => {
    if (file.products.length === 1) setPopup({ type: "replace", file, selectedProduct: file.products[0] });
    else setPopup({ type: "replace", file, selectedProduct: null });
  };

  const startReplace = () => { if (popup?.selectedProduct) replaceInputRef.current?.click(); };

  const handleReplaceFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !popup?.selectedProduct) return;
    e.target.value = "";
    const { recordId } = popup.selectedProduct;
    const savedPopup = { ...popup };
    setPopup(null);
    setReplaceUploading(true); setReplaceProgress(0);
    try {
      const sr = await fetch("/api/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "stage", files: [{ filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size }] }) });
      const sd = await sr.json();
      if (!sr.ok || sd.error) throw new Error(sd.error || "Stage failed");
      const target = sd.targets[0];
      await new Promise((res, rej) => {
        const xhr = new XMLHttpRequest(); xhr.open("PUT", target.url);
        if (target.parameters?.length) { for (const p of target.parameters) { try { xhr.setRequestHeader(p.name, p.value); } catch {} } }
        if (!target.parameters?.some((p) => p.name.toLowerCase() === "content-type")) xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) setReplaceProgress(Math.round((ev.loaded / ev.total) * 100)); };
        xhr.onerror = () => rej(new Error("Upload failed"));
        xhr.onload = () => (xhr.status < 300 ? res() : rej(new Error(`HTTP ${xhr.status}`)));
        xhr.send(file);
      });
      const rr = await fetch("/api/file-actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ _action: "replace", fileId: recordId, resourceUrl: target.resourceUrl, filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size }) });
      const rd = await rr.json();
      if (!rr.ok || rd.error) throw new Error(rd.error || "Replace failed");
      showFeedback(`File replaced in ${savedPopup.selectedProduct.productTitle}. Previous purchasers will be notified.`, false);
      navigate(".", { replace: true });
    } catch (err) { showFeedback(err.message, true); }
    finally { setReplaceUploading(false); setReplaceProgress(0); }
  };

  const inp = { padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: "8px", background: C.surface, color: C.text, fontSize: "14px", outline: "none", boxSizing: "border-box" };
  const btnP = { border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 700, fontSize: "13px", padding: "10px 22px", background: C.navy, color: "#fff", display: "inline-flex", alignItems: "center", gap: "6px" };
  const btnS = { border: `1px solid ${C.border}`, borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "12px", padding: "6px 12px", background: C.surface, color: C.text, display: "inline-flex", alignItems: "center", gap: "5px" };
  const btnD = { border: `1px solid ${C.dangerBdr}`, borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "12px", padding: "6px 12px", background: C.dangerBg, color: C.danger };
  const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: "12px", boxShadow: C.shadow };

  const FILTERS = [{ key: "all", label: "All" }, { key: "document", label: "Documents" }, { key: "image", label: "Images" }, { key: "video", label: "Video" }, { key: "audio", label: "Audio" }, { key: "archive", label: "Archives" }];

  return (
    <div style={{ padding: "20px 28px", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: C.text }}>
      <input ref={replaceInputRef} type="file" style={{ display: "none" }} onChange={handleReplaceFile} />

      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontWeight: 800, fontSize: "20px" }}>Files</div>
        <div style={{ fontSize: "13px", color: C.muted, marginTop: "3px" }}>{totalFiles} unique {totalFiles === 1 ? "file" : "files"} &middot; {totalSize} total</div>
      </div>

      {feedback && <div style={{ padding: "10px 14px", background: feedback.isError ? C.dangerBg : C.successBg, border: `1px solid ${feedback.isError ? C.dangerBdr : C.successBdr}`, borderRadius: "10px", color: feedback.isError ? C.danger : C.success, fontSize: "13px", fontWeight: 600, marginBottom: "14px" }}>{feedback.msg}</div>}

      {replaceUploading && (
        <div style={{ padding: "12px 16px", background: C.surface, border: `1px solid ${C.accent}`, borderRadius: "10px", marginBottom: "14px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>Replacing file... {replaceProgress}%</div>
          <div style={{ height: 6, background: C.border, borderRadius: 999, overflow: "hidden" }}><div style={{ height: "100%", width: `${replaceProgress}%`, background: C.accent, borderRadius: 999, transition: "width 0.3s" }} /></div>
        </div>
      )}

      {allFiles.length > 0 && (
        <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files..." style={{ ...inp, width: "240px" }} />
          <div style={{ display: "flex", gap: "4px" }}>
            {FILTERS.map((tf) => (
              <button key={tf.key} onClick={() => setTypeFilter(tf.key)} style={{ padding: "6px 12px", fontSize: "12px", fontWeight: typeFilter === tf.key ? 700 : 500, background: typeFilter === tf.key ? C.navy : C.surface, color: typeFilter === tf.key ? "#fff" : C.muted, border: `1px solid ${typeFilter === tf.key ? C.navy : C.border}`, borderRadius: "6px", cursor: "pointer" }}>{tf.label}</button>
            ))}
          </div>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ ...inp, width: "auto", padding: "6px 10px", fontSize: "12px" }}>
            <option value="date">Newest first</option><option value="name">Name A-Z</option><option value="size">Largest first</option><option value="type">File type</option>
          </select>
        </div>
      )}

      {allFiles.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: "14px", background: C.surface, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, boxShadow: C.shadow, marginBottom: "16px" }}>{TI.other(26)}</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "6px" }}>No files uploaded yet</div>
          <div style={{ fontSize: "14px", color: C.muted, maxWidth: "340px", lineHeight: 1.7, marginBottom: "16px" }}>Upload digital files by creating a product in the Digital Products section.</div>
          <button onClick={() => navigate("/app")} style={btnP}>Go to Digital Products</button>
        </div>
      )}

      {allFiles.length > 0 && filtered.length === 0 && (
        <div style={{ ...card, padding: "32px", textAlign: "center", color: C.muted, fontSize: "14px" }}>No files match your search or filter.</div>
      )}

      {/* ── File list with accordion ── */}
      {filtered.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {filtered.map((file) => {
            const cat = getTypeCategory(file.fileName);
            const Icon = TI[cat] || TI.other;
            const isOpen = expandedKey === file.key;

            return (
              <div key={file.key} style={{ ...card, overflow: "hidden" }}>
                {/* Collapsed row — always visible */}
                <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", gap: "14px", cursor: "pointer" }} onClick={() => setExpandedKey(isOpen ? null : file.key)}>
                  <div style={{ width: 38, height: 38, borderRadius: "9px", background: C.pill, display: "flex", alignItems: "center", justifyContent: "center", color: C.accent, flexShrink: 0 }}>{Icon(18)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.displayName}</div>
                  </div>
                  <span style={{ fontSize: "10px", fontWeight: 700, color: C.accent, background: "rgba(245,165,36,0.1)", padding: "2px 8px", borderRadius: "5px", flexShrink: 0 }}>{getFileType(file.fileName)}</span>
                  <span style={{ fontSize: "13px", color: C.muted, flexShrink: 0, minWidth: "60px", textAlign: "right" }}>{file.fileSize}</span>
                  <button onClick={(e) => { e.stopPropagation(); setExpandedKey(isOpen ? null : file.key); }} style={{ ...btnS, fontSize: "12px", padding: "5px 12px", color: isOpen ? C.navy : C.muted, borderColor: isOpen ? C.navy : C.border }}>
                    {isOpen ? "Hide" : "View Details"}
                  </button>
                </div>

                {/* Expanded details — smooth accordion */}
                <AccordionPanel open={isOpen}>
                  <div style={{ borderTop: `1px solid ${C.border}`, padding: "16px 18px", background: "#FAFBFC" }}>
                    {/* Meta row — only fields NOT shown in collapsed view */}
                    <div style={{ display: "flex", gap: "24px", marginBottom: "16px", flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: "10px", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>First Uploaded</div>
                        <div style={{ fontSize: "13px", fontWeight: 600 }}>{new Date(file.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "10px", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>MIME Type</div>
                        <div style={{ fontSize: "13px", fontWeight: 600 }}>{file.mimeType || "–"}</div>
                      </div>
                    </div>

                    {/* Assigned products */}
                    <div style={{ marginBottom: "16px" }}>
                      <div style={{ fontSize: "10px", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>Assigned to {file.products.length} {file.products.length === 1 ? "product" : "products"}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                        {file.products.map((p) => (
                          <div key={p.recordId} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: "8px" }}>
                            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                            <span style={{ fontSize: "13px", fontWeight: 500, flex: 1 }}>{p.productTitle}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => onReplaceClick(file)} disabled={replaceUploading} style={{ ...btnS, opacity: replaceUploading ? 0.5 : 1 }}>Replace</button>
                      <button onClick={() => onDeleteClick(file)} style={btnD}>Delete</button>
                    </div>
                  </div>
                </AccordionPanel>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Popup: Product picker + Confirm ── */}
      {popup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "28px 32px", maxWidth: "460px", width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>
            <div style={{ width: 48, height: 48, borderRadius: "12px", background: popup.type === "delete" ? C.dangerBg : "rgba(245,165,36,0.1)", border: `1px solid ${popup.type === "delete" ? C.dangerBdr : C.accent}`, display: "flex", alignItems: "center", justifyContent: "center", color: popup.type === "delete" ? C.danger : C.accent, marginBottom: "16px" }}>
              {popup.type === "delete"
                ? <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                : <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>}
            </div>
            <div style={{ fontSize: "18px", fontWeight: 800, marginBottom: "6px" }}>{popup.type === "delete" ? "Delete File" : "Replace File"}</div>
            <div style={{ fontSize: "14px", color: C.muted, marginBottom: "16px" }}>
              <strong style={{ color: C.text }}>{popup.file.displayName}</strong>
              {popup.file.products.length > 1 && !popup.selectedProduct && <span> is used in {popup.file.products.length} products. Select which product to {popup.type === "delete" ? "remove it from" : "replace it in"}:</span>}
              {popup.file.products.length === 1 && popup.type === "delete" && <span> is the only file in <strong style={{ color: C.text }}>{popup.file.products[0].productTitle}</strong>. Deleting it will also <strong style={{ color: C.danger }}>remove the product</strong> from Pendora.</span>}
              {popup.file.products.length === 1 && popup.type === "replace" && <span> in <strong style={{ color: C.text }}>{popup.file.products[0].productTitle}</strong> will be replaced. Previous purchasers will be notified.</span>}
            </div>

            {popup.file.products.length > 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "18px" }}>
                {popup.file.products.map((p) => {
                  const isSel = popup.selectedProduct?.recordId === p.recordId;
                  return (
                    <div key={p.recordId} onClick={() => setPopup({ ...popup, selectedProduct: p })} style={{ padding: "10px 14px", border: `2px solid ${isSel ? C.navy : C.border}`, borderRadius: "10px", background: isSel ? "rgba(27,43,68,0.04)" : C.surface, cursor: "pointer" }}>
                      <div style={{ fontWeight: 600, fontSize: "14px" }}>{p.productTitle}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {popup.selectedProduct && popup.file.products.length > 1 && (
              <div style={{ fontSize: "13px", color: C.muted, marginBottom: "16px", padding: "8px 12px", background: C.bg, borderRadius: "8px" }}>
                {popup.type === "delete"
                  ? <>File will be removed from <strong style={{ color: C.text }}>{popup.selectedProduct.productTitle}</strong>. Other products keep their copy.</>
                  : <>File in <strong style={{ color: C.text }}>{popup.selectedProduct.productTitle}</strong> will be replaced. Previous purchasers of this product will be notified.</>}
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button onClick={() => setPopup(null)} style={{ ...btnS, padding: "10px 20px", fontSize: "13px" }}>Cancel</button>
              {popup.type === "delete" && <button onClick={confirmDelete} disabled={!popup.selectedProduct} style={{ ...btnD, padding: "10px 20px", fontSize: "13px", fontWeight: 700, opacity: popup.selectedProduct ? 1 : 0.4 }}>Delete</button>}
              {popup.type === "replace" && <button onClick={startReplace} disabled={!popup.selectedProduct} style={{ ...btnP, opacity: popup.selectedProduct ? 1 : 0.4 }}>Choose File</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
