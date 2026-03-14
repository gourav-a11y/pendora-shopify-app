import { useState, useRef, useEffect } from "react";
import { useLoaderData, useFetcher, useRevalidator, useRouteError, isRouteErrorResponse } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateDownloadToken } from "../utils/token.server";

function formatFileSize(bytes) {
  if (!bytes) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Day: Serene Nature Tones  |  Night: Black & Gold Elegance ─────────────────
// Solid colors only — no gradients.
const DAY = {
  headerBg:   '#567870',
  bg:         '#f2f8f5',
  sidebar:    '#e2eeea',
  sidebarBdr: '#c4d8d0',
  surface:    '#d8eae4',
  border:     '#b4ccc4',
  accent:     '#6a9e8c',
  accentText: '#ffffff',
  active:     '#567870',
  activeBg:   '#ccddd8',
  activeBdr:  '#567870',
  text:       '#1c3028',
  muted:      '#527060',
  faint:      '#88aaa0',
  danger:     '#8b2e20',
  dangerBg:   '#fce8e6',
  dangerBdr:  '#d89090',
  success:    '#2e7050',
  successBg:  '#e6f5ec',
  successBdr: '#80c098',
  badgeBg:    '#c4e0d8',
  badgeBdr:   '#9cc4b8',
  badgeText:  '#1e4838',
  stepDone:   '#6a9e8c',
  stepActive: '#567870',
  stepLine:   '#c4d8d0',
  inputBdr:   '#b4ccc4',
  inputBg:    '#f2f8f5',
  shadow:     '0 1px 6px rgba(40,80,64,0.10)',
  pill:       'rgba(106,158,140,0.15)',
};
const NIGHT = {
  headerBg:   '#111828',
  bg:         '#0a0a0a',
  sidebar:    '#111828',
  sidebarBdr: '#1f2a40',
  surface:    '#151d2e',
  border:     '#243050',
  accent:     '#d4950a',
  accentText: '#0a0a0a',
  active:     '#d4950a',
  activeBg:   '#1a1608',
  activeBdr:  '#d4950a',
  text:       '#f0f0f0',
  muted:      '#788899',
  faint:      '#3a4a60',
  danger:     '#e05040',
  dangerBg:   '#1a0e0e',
  dangerBdr:  '#6a2020',
  success:    '#3a9060',
  successBg:  '#0e1a12',
  successBdr: '#2a5a38',
  badgeBg:    '#1f2a3f',
  badgeBdr:   '#2a3a55',
  badgeText:  '#8898bb',
  stepDone:   '#d4950a',
  stepActive: '#d4950a',
  stepLine:   '#243050',
  inputBdr:   '#243050',
  inputBg:    '#0f1520',
  shadow:     '0 2px 10px rgba(0,0,0,0.45)',
  pill:       'rgba(212,149,10,0.10)',
};

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const Ic = {
  box: (s = 18) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  ),
  upload: (s = 18) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
  ),
  download: (s = 15) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
    </svg>
  ),
  trash: (s = 15) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
  ),
  file: (s = 18) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
  ),
  plus: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  sun: (s = 15) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  ),
  moon: (s = 15) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  ),
  search: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  check: (s = 13) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  spark: (s = 20) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.8 5.4L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.6z"/>
      <path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>
      <path d="M5 3l.5 1.5 1.5.5-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z"/>
    </svg>
  ),
};

const WIZARD_STEPS = ["Select Product", "Upload Files", "Review & Save"];

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const [filesResult, shopifyRes] = await Promise.all([
    prisma.productFile.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "desc" } }),
    admin.graphql(`#graphql
      query getProducts {
        products(first: 100, sortKey: TITLE) {
          edges { node { id title status featuredImage { url } } }
        }
      }
    `),
  ]);

  // Sync product metafields (fire-and-forget) for checkout extension
  const uniqueProductIds = [...new Set(filesResult.map((f) => f.productId))];
  for (const pid of uniqueProductIds) {
    const pFiles = filesResult.filter((f) => f.productId === pid);
    const value = JSON.stringify(pFiles.map((f) => ({ fileId: f.id, displayName: f.displayName || f.fileName, fileUrl: f.fileUrl })));
    admin.graphql(
      `mutation SyncMetafield($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`,
      { variables: { m: [{ ownerId: pid, namespace: "pendora", key: "files", type: "json", value }] } }
    ).catch((e) => console.error("[Pendora] Metafield sync failed:", e?.message ?? e));
  }

  const productMap = {};
  for (const f of filesResult) {
    if (!productMap[f.productId]) {
      productMap[f.productId] = { productId: f.productId, productTitle: f.productTitle || "Unknown Product", files: [] };
    }
    productMap[f.productId].files.push({ id: f.id, fileName: f.fileName, displayName: f.displayName || f.fileName, fileSize: formatFileSize(f.fileSize), createdAt: f.createdAt.toISOString(), downloadToken: generateDownloadToken(f.id) });
  }

  const digitalProducts = Object.values(productMap);
  const existingIds = new Set(digitalProducts.map((p) => p.productId));
  const shopifyData = await shopifyRes.json();
  const shopifyProducts = shopifyData.data.products.edges.map((e) => ({ ...e.node, alreadyCreated: existingIds.has(e.node.id) }));
  return { digitalProducts, shopifyProducts };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    if (formData.get("_action") === "delete") {
      const fileId = formData.get("fileId");
      if (!fileId) return { error: "No file ID provided." };
      const file = await prisma.productFile.findFirst({ where: { id: fileId, shop } });
      if (!file) return { error: "File not found." };
      await prisma.productFile.delete({ where: { id: fileId } });
      const remaining = await prisma.productFile.findMany({ where: { shop, productId: file.productId }, orderBy: { createdAt: "desc" } });
      const value = JSON.stringify(remaining.map((f) => ({ fileId: f.id, displayName: f.displayName || f.fileName, fileUrl: f.fileUrl })));
      admin.graphql(
        `mutation SyncMetafield($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`,
        { variables: { m: [{ ownerId: file.productId, namespace: "pendora", key: "files", type: "json", value }] } }
      ).catch(() => {});
      return { success: "File deleted." };
    }
    return { error: "Unknown action." };
  } catch (err) {
    if (err instanceof Response) throw err;
    return { error: "Action failed: " + err.message };
  }
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { digitalProducts, shopifyProducts } = useLoaderData();
  const deleteFetcher = useFetcher();
  const { revalidate } = useRevalidator();

  const [isDark, setIsDark] = useState(false);
  const t = isDark ? NIGHT : DAY;

  const [mode, setMode] = useState("view");
  const [selectedId, setSelectedId] = useState(() => digitalProducts[0]?.productId || null);
  const fileInputRef = useRef(null);
  const [displayName, setDisplayName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const wizardFileInputRef = useRef(null);
  const [wStep, setWStep] = useState(1);
  const [wSearch, setWSearch] = useState("");
  const [wProduct, setWProduct] = useState(null);
  const [wFiles, setWFiles] = useState([]);
  const [wSubmitting, setWSubmitting] = useState(false);
  const [wError, setWError] = useState(null);

  // Optimistic delete — IDs removed from UI immediately, revalidate silently after
  const [pendingDeleteIds, setPendingDeleteIds] = useState(new Set());

  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data) {
      setPendingDeleteIds(new Set());
      revalidate();
    }
  }, [deleteFetcher.state, deleteFetcher.data]);

  const selected = digitalProducts.find((p) => p.productId === selectedId) || null;
  const isBusy = isUploading;

  const selectProduct = (id) => { setSelectedId(id); setMode("view"); setUploadError(null); setUploadSuccess(null); };
  const openCreate = () => { setMode("create"); setWStep(1); setWSearch(""); setWProduct(null); setWFiles([]); setWError(null); };

  const handleUpload = async () => {
    if (isBusy || !selected) return;
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setIsUploading(true); setUploadError(null); setUploadSuccess(null);
    try {
      const sr = await fetch("/api/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "stage", files: [{ filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size }] }) });
      const sd = await sr.json();
      if (!sr.ok || sd.error) throw new Error(sd.error || "Stage failed.");
      const target = sd.targets[0];
      await new Promise((res, rej) => {
        const xhr = new XMLHttpRequest(); xhr.open("PUT", target.url);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream"); xhr.timeout = 300000;
        xhr.ontimeout = () => rej(new Error("Timed out.")); xhr.onerror = () => rej(new Error("Network error."));
        xhr.onload = () => xhr.status < 300 ? res() : rej(new Error(`HTTP ${xhr.status}`)); xhr.send(file);
      });
      const svr = await fetch("/api/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "save", files: [{ resourceUrl: target.resourceUrl, filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, displayName: displayName || file.name }], productId: selected.productId, productTitle: selected.productTitle, downloadEnabled: true }) });
      const svd = await svr.json();
      if (!svr.ok || svd.error) throw new Error(svd.error || "Save failed.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setDisplayName(""); setUploadSuccess(`"${file.name}" uploaded.`); revalidate();
    } catch (err) { setUploadError(err.message); }
    finally { setIsUploading(false); }
  };

  const handleDelete = (fileId) => {
    setPendingDeleteIds((prev) => { const n = new Set(prev); n.add(fileId); return n; });
    const fd = new FormData(); fd.append("_action", "delete"); fd.append("fileId", fileId);
    deleteFetcher.submit(fd, { method: "POST" });
  };

  const wizardPickFiles = (e) => {
    const newFiles = Array.from(e.target.files || []);
    setWFiles((prev) => { const ex = new Set(prev.map((f) => f.name + f.size)); return [...prev, ...newFiles.filter((f) => !ex.has(f.name + f.size))]; });
    e.target.value = "";
  };

  const handleWizardSubmit = async () => {
    if (wSubmitting || !wProduct || !wFiles.length) return;
    setWSubmitting(true); setWError(null);
    try {
      const sr = await fetch("/api/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "stage", files: wFiles.map((f) => ({ filename: f.name, mimeType: f.type || "application/octet-stream", fileSize: f.size })) }) });
      const sd = await sr.json();
      if (!sr.ok || sd.error) throw new Error(sd.error || "Stage failed.");
      const uploaded = [];
      for (let i = 0; i < wFiles.length; i++) {
        const file = wFiles[i]; const target = sd.targets[i];
        await new Promise((res, rej) => {
          const xhr = new XMLHttpRequest(); xhr.open("PUT", target.url);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream"); xhr.timeout = 300000;
          xhr.ontimeout = () => rej(new Error(`Timeout: "${file.name}"`)); xhr.onerror = () => rej(new Error(`Network: "${file.name}"`));
          xhr.onload = () => xhr.status < 300 ? res() : rej(new Error(`HTTP ${xhr.status}: "${file.name}"`)); xhr.send(file);
        });
        uploaded.push({ resourceUrl: target.resourceUrl, filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, displayName: file.name });
      }
      const svr = await fetch("/api/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "save", files: uploaded, productId: wProduct.id, productTitle: wProduct.title, downloadEnabled: true }) });
      const svd = await svr.json();
      if (!svr.ok || svd.error) throw new Error(svd.error || "Save failed.");
      setSelectedId(wProduct.id); setMode("view"); revalidate();
    } catch (err) { setWError(err.message); }
    finally { setWSubmitting(false); }
  };

  const filteredShopify = shopifyProducts.filter((p) => p.title.toLowerCase().includes(wSearch.toLowerCase()));

  // ── Style helpers ──────────────────────────────────────────────────────────
  const inp = { padding: "8px 12px", border: `1px solid ${t.inputBdr}`, borderRadius: "8px", background: t.inputBg, color: t.text, fontSize: "14px", outline: "none", width: "100%", boxSizing: "border-box" };
  const B = {
    primary:   { border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 700, fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", padding: "9px 20px", background: t.active, color: t.accentText },
    secondary: { border: `1px solid ${t.border}`, borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: t.surface, color: t.text },
    danger:    { border: `1px solid ${t.dangerBdr}`, borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 12px", background: t.dangerBg, color: t.danger },
    ghost:     { border: `1px solid ${t.border}`, borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "transparent", color: t.muted },
  };

  // ── Header bar ─────────────────────────────────────────────────────────────
  const renderHeader = () => (
    <div style={{ background: t.headerBg, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: 34, height: 34, borderRadius: "9px", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
          {Ic.spark(18)}
        </div>
        <div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: "17px", letterSpacing: "-0.2px", lineHeight: 1.1 }}>Pendora</div>
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: "10px", fontWeight: 500, letterSpacing: "0.6px" }}>DIGITAL PRODUCTS</div>
        </div>
      </div>
      <button
        onClick={() => setIsDark((d) => !d)}
        style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: "20px", padding: "5px 14px", color: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}
      >
        {isDark ? Ic.sun() : Ic.moon()} {isDark ? "Day Mode" : "Night Mode"}
      </button>
    </div>
  );

  // ── Outer shell ────────────────────────────────────────────────────────────
  const wrap = (inner) => (
    <div style={{ position: "fixed", inset: 0, background: t.bg, color: t.text, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {renderHeader()}
      {inner}
    </div>
  );

  // ── Main layout (always 2-panel) ──────────────────────────────────────────
  return wrap(
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

      {/* Sidebar */}
      <div style={{ width: "255px", flexShrink: 0, background: t.sidebar, borderRight: `1px solid ${t.sidebarBdr}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "11px 16px", borderBottom: `1px solid ${t.sidebarBdr}`, flexShrink: 0 }}>
          <div style={{ fontSize: "10px", fontWeight: 800, color: t.muted, textTransform: "uppercase", letterSpacing: "0.9px" }}>Your Products</div>
        </div>
        {/* Add New Product — top of list */}
        <div onClick={openCreate} style={{ padding: "11px 14px", borderBottom: `1px solid ${t.sidebarBdr}`, background: mode === "create" ? t.activeBg : "transparent", borderLeft: `3px solid ${mode === "create" ? t.activeBdr : "transparent"}`, cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: "8px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: t.accent }}>
            {Ic.plus(15)}
          </div>
          <span style={{ fontWeight: 700, fontSize: "13px", color: t.accent }}>Add New Product</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {digitalProducts.map((p) => {
            const isActive = p.productId === selectedId && mode === "view";
            return (
              <div key={p.productId} onClick={() => selectProduct(p.productId)}
                style={{ padding: "11px 14px", borderBottom: `1px solid ${t.sidebarBdr}`, background: isActive ? t.activeBg : "transparent", borderLeft: `3px solid ${isActive ? t.activeBdr : "transparent"}`, cursor: "pointer", display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: 32, height: 32, borderRadius: "8px", background: isActive ? (isDark ? "rgba(212,149,10,0.2)" : "rgba(86,120,112,0.18)") : t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: isActive ? t.active : t.accent, flexShrink: 0 }}>
                  {Ic.box(16)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "13px", color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.productTitle}</div>
                  <span style={{ fontSize: "10px", fontWeight: 700, background: t.badgeBg, color: t.badgeText, padding: "1px 7px", borderRadius: "8px", border: `1px solid ${t.badgeBdr}`, marginTop: "3px", display: "inline-block" }}>
                    {p.files.length} {p.files.length === 1 ? "file" : "files"}
                  </span>
                </div>
                {isActive && <div style={{ color: t.active, flexShrink: 0 }}>{Ic.check()}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, overflowY: "auto", background: t.bg }}>

        {mode === "create" && (
          <div style={{ flex: 1, overflowY: "auto", display: "flex", justifyContent: "center", padding: "40px 32px" }}>
            <div style={{ width: "100%", maxWidth: "700px" }}>
              <Wizard B={B} inp={inp} Ic={Ic} t={t} isDark={isDark}
                step={wStep} setStep={setWStep} search={wSearch} setSearch={setWSearch}
                wProduct={wProduct} setWProduct={setWProduct} wFiles={wFiles} setWFiles={setWFiles}
                wSubmitting={wSubmitting} wError={wError} filteredShopify={filteredShopify}
                wizardFileInputRef={wizardFileInputRef} wizardPickFiles={wizardPickFiles}
                handleWizardSubmit={handleWizardSubmit} onCancel={() => setMode("view")} />
            </div>
          </div>
        )}

        {/* No products at all — humorous empty state */}
        {mode === "view" && !digitalProducts.length && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "16px", textAlign: "center", padding: "40px 48px" }}>
            <div style={{ fontSize: "52px", lineHeight: 1 }}>📦</div>
            <div style={{ fontSize: "22px", fontWeight: 800, color: t.text }}>Nothing to sell yet?</div>
            <div style={{ fontSize: "14px", color: t.muted, maxWidth: "380px", lineHeight: 1.75 }}>
              Your digital shelf is emptier than a Wi-Fi router in the middle of the ocean.
              <br />Add your first product and let the downloads begin!
            </div>
            <button onClick={openCreate} style={{ ...B.primary, padding: "11px 28px", fontSize: "14px", borderRadius: "10px", marginTop: "4px" }}>{Ic.plus(15)} Create First Product</button>
          </div>
        )}

        {mode === "view" && digitalProducts.length > 0 && !selected && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "10px", color: t.muted }}>
            {Ic.box(30)} <div style={{ fontSize: "14px" }}>Select a product from the sidebar</div>
          </div>
        )}

        {mode === "view" && selected && (() => {
          const visibleFiles = selected.files.filter((f) => !pendingDeleteIds.has(f.id));
          return (
            <div style={{ padding: "22px 28px" }}>
              {/* Title */}
              <div style={{ marginBottom: "20px", paddingBottom: "16px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: 42, height: 42, borderRadius: "11px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: t.accent, flexShrink: 0 }}>
                  {Ic.box(21)}
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: t.text }}>{selected.productTitle}</h2>
                  <div style={{ fontSize: "12px", color: t.muted, marginTop: "2px" }}>{visibleFiles.length} {visibleFiles.length === 1 ? "file" : "files"} attached</div>
                </div>
              </div>

              {isUploading && (
                <div style={{ padding: "10px 15px", marginBottom: "16px", background: t.pill, border: `1px solid ${t.active}`, borderRadius: "9px", color: t.active, fontWeight: 600, fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
                  ⏳ Uploading… please wait.
                </div>
              )}

              {/* Upload */}
              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", padding: "18px 20px", marginBottom: "16px", boxShadow: t.shadow }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "14px" }}>
                  <div style={{ color: t.active }}>{Ic.upload(15)}</div>
                  <span style={{ fontWeight: 800, fontSize: "11px", color: t.muted, textTransform: "uppercase", letterSpacing: "0.7px" }}>Upload File</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
                  <div>
                    <label style={{ display: "block", marginBottom: "4px", fontWeight: 600, fontSize: "12px", color: t.muted }}>Select File</label>
                    <input ref={fileInputRef} type="file" disabled={isBusy} accept=".pdf,.zip,.mp3,.mp4,.png,.jpg,.jpeg,.gif,.webp,.mov,.epub,.docx,.xlsx" style={{ color: t.text, fontSize: "13px", opacity: isBusy ? 0.5 : 1 }} />
                    <div style={{ fontSize: "11px", color: t.faint, marginTop: "3px" }}>Max 100 MB — PDF, ZIP, MP3, MP4, PNG, JPG, GIF, EPUB, DOCX, XLSX</div>
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: "4px", fontWeight: 600, fontSize: "12px", color: t.muted }}>Display Name</label>
                    <input type="text" value={displayName} disabled={isBusy} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. User Guide PDF" style={{ ...inp, width: "260px", opacity: isBusy ? 0.5 : 1 }} />
                  </div>
                  <button disabled={isBusy} onClick={handleUpload} style={{ ...B.primary, opacity: isBusy ? 0.6 : 1, alignSelf: "flex-start" }}>
                    {Ic.upload(14)} {isUploading ? "Uploading…" : "Upload File"}
                  </button>
                  {uploadError && <div style={{ padding: "9px 13px", background: t.dangerBg, border: `1px solid ${t.dangerBdr}`, borderRadius: "8px", color: t.danger, fontSize: "13px" }}>{uploadError}</div>}
                  {uploadSuccess && <div style={{ padding: "9px 13px", background: t.successBg, border: `1px solid ${t.successBdr}`, borderRadius: "8px", color: t.success, fontSize: "13px" }}>✓ {uploadSuccess}</div>}
                </div>
              </div>

              {/* Files */}
              <div style={{ background: t.surface, borderRadius: "12px", border: `1px solid ${t.border}`, overflow: "hidden", boxShadow: t.shadow }}>
                <div style={{ padding: "12px 18px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: "7px" }}>
                  <div style={{ color: t.active }}>{Ic.file(14)}</div>
                  <span style={{ fontWeight: 800, fontSize: "11px", color: t.muted, textTransform: "uppercase", letterSpacing: "0.7px" }}>Attached Files ({visibleFiles.length})</span>
                </div>
                {deleteFetcher.data?.error && <div style={{ padding: "9px 18px", background: t.dangerBg, color: t.danger, fontSize: "13px", borderBottom: `1px solid ${t.dangerBdr}` }}>{deleteFetcher.data.error}</div>}
                {!visibleFiles.length
                  ? <div style={{ padding: "26px", textAlign: "center", color: t.faint, fontSize: "14px" }}>No files yet. Upload one above.</div>
                  : visibleFiles.map((file, idx) => (
                    <div key={file.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: idx < visibleFiles.length - 1 ? `1px solid ${t.border}` : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
                        <div style={{ width: 36, height: 36, borderRadius: "9px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: t.active, flexShrink: 0 }}>{Ic.file(18)}</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "14px", color: t.text }}>{file.displayName}</div>
                          {file.displayName !== file.fileName && <div style={{ fontSize: "11px", color: t.faint }}>{file.fileName}</div>}
                          <div style={{ fontSize: "11px", color: t.muted, marginTop: "1px" }}>{file.fileSize} · {new Date(file.createdAt).toLocaleDateString()}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <a href={`/api/files/${file.id}?token=${file.downloadToken}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                          <button style={B.secondary}>{Ic.download(14)} Preview</button>
                        </a>
                        <button onClick={() => handleDelete(file.id)} style={B.danger}>
                          {Ic.trash(14)} Delete
                        </button>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

function Wizard({ B, inp, Ic, t, isDark, step, setStep, search, setSearch, wProduct, setWProduct, wFiles, setWFiles, wSubmitting, wError, filteredShopify, wizardFileInputRef, wizardPickFiles, handleWizardSubmit, onCancel }) {
  const stepBtnBase = { padding: "11px 28px", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px", border: "none", transition: "opacity 0.15s" };

  return (
    <div style={{ width: "100%" }}>

      {/* ── Step indicator ── */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: "36px", padding: "0 4px" }}>
        {WIZARD_STEPS.map((label, i) => {
          const num = i + 1; const isActive = step === num; const isDone = step > num;
          return (
            <div key={num} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: isDone ? t.stepDone : isActive ? t.stepActive : t.border, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "13px", color: (isDone || isActive) ? "#fff" : t.muted, boxShadow: isActive ? `0 0 0 5px ${t.pill}` : "none" }}>
                  {isDone ? Ic.check(13) : num}
                </div>
                <span style={{ fontSize: "11px", marginTop: "7px", color: isActive ? t.text : t.muted, fontWeight: isActive ? 700 : 500, whiteSpace: "nowrap", letterSpacing: "0.1px" }}>{label}</span>
              </div>
              {i < WIZARD_STEPS.length - 1 && <div style={{ flex: 1, height: "2px", background: step > num ? t.stepDone : t.stepLine, margin: "0 10px", marginBottom: "22px", borderRadius: "2px" }} />}
            </div>
          );
        })}
      </div>

      {/* ── Step 1: Select product ── */}
      {step === 1 && (
        <div>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 800, fontSize: "20px", color: t.text, marginBottom: "4px" }}>Choose a product</div>
            <div style={{ fontSize: "13px", color: t.muted }}>Select the product you want to attach digital files to.</div>
          </div>
          <div style={{ position: "relative", marginBottom: "14px" }}>
            <span style={{ position: "absolute", left: "13px", top: "50%", transform: "translateY(-50%)", color: t.muted }}>{Ic.search(15)}</span>
            <input type="text" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inp, paddingLeft: "38px", fontSize: "14px", padding: "11px 13px 11px 38px" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "380px", overflowY: "auto", marginBottom: "24px" }}>
            {!filteredShopify.length
              ? <div style={{ color: t.muted, fontSize: "14px", padding: "32px", textAlign: "center", background: t.surface, borderRadius: "12px", border: `1px solid ${t.border}` }}>No products found.</div>
              : filteredShopify.map((product) => {
                const isSel = wProduct?.id === product.id;
                return (
                  <div key={product.id} onClick={() => !product.alreadyCreated && setWProduct(product)}
                    style={{ display: "flex", alignItems: "center", gap: "13px", padding: "13px 16px", border: `2px solid ${isSel ? t.activeBdr : t.border}`, borderRadius: "12px", background: isSel ? t.activeBg : t.surface, cursor: product.alreadyCreated ? "default" : "pointer", opacity: product.alreadyCreated ? 0.45 : 1, transition: "border-color 0.12s, background 0.12s" }}>
                    {product.featuredImage?.url
                      ? <img src={product.featuredImage.url} alt={product.title} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: "9px", flexShrink: 0 }} />
                      : <div style={{ width: 44, height: 44, background: t.pill, borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center", color: t.accent, flexShrink: 0 }}>{Ic.box(20)}</div>
                    }
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: t.text }}>{product.title}</div>
                      <div style={{ fontSize: "12px", color: t.muted, marginTop: "2px", textTransform: "capitalize" }}>{product.status.toLowerCase()}</div>
                    </div>
                    {product.alreadyCreated && <span style={{ fontSize: "11px", background: t.badgeBg, color: t.badgeText, padding: "3px 9px", borderRadius: "8px", fontWeight: 700 }}>Already added</span>}
                    {isSel && !product.alreadyCreated && <div style={{ color: t.active }}>{Ic.check(16)}</div>}
                  </div>
                );
              })}
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <button onClick={onCancel} style={{ ...stepBtnBase, background: t.surface, border: `1px solid ${t.border}`, color: t.muted }}>Cancel</button>
            <button disabled={!wProduct} onClick={() => wProduct && setStep(2)} style={{ ...stepBtnBase, background: wProduct ? t.active : t.border, color: "#fff", opacity: wProduct ? 1 : 0.6 }}>Upload Files →</button>
          </div>
        </div>
      )}

      {/* ── Step 2: Upload files ── */}
      {step === 2 && (
        <div>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 800, fontSize: "20px", color: t.text, marginBottom: "4px" }}>Upload files</div>
            <div style={{ fontSize: "13px", color: t.muted }}>For <strong style={{ color: t.text }}>{wProduct?.title}</strong></div>
          </div>
          <input ref={wizardFileInputRef} type="file" multiple style={{ display: "none" }} onChange={wizardPickFiles} />
          <button onClick={() => wizardFileInputRef.current?.click()}
            style={{ ...stepBtnBase, background: t.surface, border: `1px solid ${t.border}`, color: t.text, marginBottom: "8px" }}>
            {Ic.plus(15)} Add Files
          </button>
          <div style={{ fontSize: "12px", color: t.faint, marginBottom: "16px" }}>Max 100 MB — PDF, ZIP, MP3, MP4, PNG, JPG, GIF, EPUB, DOCX, XLSX</div>
          {!wFiles.length
            ? <div style={{ padding: "36px 24px", border: `2px dashed ${t.border}`, borderRadius: "14px", textAlign: "center", color: t.muted, fontSize: "14px", marginBottom: "24px", background: t.surface, display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                <div style={{ color: t.accent, opacity: 0.7 }}>{Ic.upload(32)}</div>
                No files selected yet. Click "Add Files" above.
              </div>
            : <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "24px" }}>
                {wFiles.map((file, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", border: `1px solid ${t.border}`, borderRadius: "11px", background: t.surface }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: 38, height: 38, borderRadius: "9px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: t.accent, flexShrink: 0 }}>{Ic.file(18)}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: t.text }}>{file.name}</div>
                        <div style={{ fontSize: "12px", color: t.muted, marginTop: "2px" }}>{formatFileSize(file.size)}</div>
                      </div>
                    </div>
                    <button onClick={() => setWFiles((p) => p.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: t.muted, cursor: "pointer", fontSize: "22px", lineHeight: 1, padding: "0 6px" }}>×</button>
                  </div>
                ))}
              </div>
          }
          <div style={{ display: "flex", gap: "12px" }}>
            <button onClick={() => setStep(1)} style={{ ...stepBtnBase, background: t.surface, border: `1px solid ${t.border}`, color: t.muted }}>← Back</button>
            <button disabled={!wFiles.length} onClick={() => wFiles.length && setStep(3)} style={{ ...stepBtnBase, background: wFiles.length ? t.active : t.border, color: "#fff", opacity: wFiles.length ? 1 : 0.6 }}>Review →</button>
          </div>
        </div>
      )}

      {/* ── Step 3: Review ── */}
      {step === 3 && (
        <div>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 800, fontSize: "20px", color: t.text, marginBottom: "4px" }}>Review & Save</div>
            <div style={{ fontSize: "13px", color: t.muted }}>Confirm the details below and save your digital product.</div>
          </div>
          {wSubmitting && (
            <div style={{ padding: "13px 18px", background: t.pill, border: `1px solid ${t.active}`, borderRadius: "11px", color: t.active, fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
              ⏳ Uploading & saving…
            </div>
          )}
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "14px", padding: "22px 24px", marginBottom: "16px", opacity: wSubmitting ? 0.6 : 1 }}>
            <div style={{ fontWeight: 800, fontSize: "11px", color: t.muted, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "16px" }}>Summary</div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "13px", paddingBottom: "13px", borderBottom: `1px solid ${t.border}` }}>
              <div style={{ width: 36, height: 36, borderRadius: "9px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: t.active, flexShrink: 0 }}>{Ic.box(18)}</div>
              <div>
                <div style={{ fontSize: "12px", color: t.muted, marginBottom: "2px" }}>Product</div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: t.text }}>{wProduct?.title}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
              <div style={{ width: 36, height: 36, borderRadius: "9px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: t.active, flexShrink: 0, marginTop: "2px" }}>{Ic.file(18)}</div>
              <div>
                <div style={{ fontSize: "12px", color: t.muted, marginBottom: "4px" }}>Files ({wFiles.length})</div>
                {wFiles.map((f, i) => (
                  <div key={i} style={{ fontSize: "14px", fontWeight: 600, color: t.text, marginBottom: "3px" }}>{f.name} <span style={{ fontWeight: 400, color: t.muted, fontSize: "12px" }}>({formatFileSize(f.size)})</span></div>
                ))}
              </div>
            </div>
          </div>
          {wError && <div style={{ padding: "12px 16px", background: t.dangerBg, border: `1px solid ${t.dangerBdr}`, borderRadius: "10px", color: t.danger, fontSize: "14px", marginBottom: "16px" }}>{wError}</div>}
          <div style={{ display: "flex", gap: "12px" }}>
            <button disabled={wSubmitting} onClick={() => setStep(2)} style={{ ...stepBtnBase, background: t.surface, border: `1px solid ${t.border}`, color: t.muted, opacity: wSubmitting ? 0.5 : 1 }}>← Back</button>
            <button disabled={wSubmitting} onClick={handleWizardSubmit} style={{ ...stepBtnBase, background: t.active, color: "#fff", padding: "11px 32px", opacity: wSubmitting ? 0.7 : 1 }}>
              {wSubmitting ? "Saving…" : "✓ Create Product"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const statusCode = isRouteErrorResponse(error) ? error.status : null;
  const message = isRouteErrorResponse(error) ? (error.data?.message || error.statusText || "Error.") : error instanceof Error ? error.message : "Unexpected error.";
  return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      {statusCode && <p style={{ fontSize: "48px", fontWeight: 700, color: "#d72c0d", margin: "0 0 8px" }}>{statusCode}</p>}
      <p style={{ color: "#6d7175", marginBottom: "24px" }}>{message}</p>
      <button onClick={() => window.location.reload()} style={{ padding: "10px 24px", borderRadius: "8px", border: "1px solid #ccc", cursor: "pointer", fontSize: "14px" }}>Reload Page</button>
    </div>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
