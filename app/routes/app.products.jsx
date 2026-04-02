import { useState, useRef, useEffect } from "react";
import { useLoaderData, useFetcher, useRevalidator, useRouteError, isRouteErrorResponse } from "react-router";
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

// ── Color themes ──────────────────────────────────────────────────────────────
// Day  = Golden Summer Fields   Night = Black & Gold Elegance
const DAY = {
  bg:           '#faf5eb',
  sidebar:      '#f2e8d0',
  sidebarBdr:   '#dbc898',
  surface:      '#ede3c8',
  surfaceHov:   '#e4d8b8',
  border:       '#d0bc8c',
  accent:       '#b2c5a0',
  accentDark:   '#8aac78',
  accentText:   '#fff',
  active:       '#c49060',
  activeBg:     '#fdf0e0',
  activeBdr:    '#c49060',
  text:         '#3a2a18',
  muted:        '#7a6050',
  faint:        '#a89070',
  danger:       '#a83020',
  dangerBg:     '#fdecea',
  dangerBdr:    '#d88070',
  success:      '#4a8050',
  successBg:    '#eef5ec',
  successBdr:   '#88c080',
  headerGrad:   'linear-gradient(135deg, #b2c5a0 0%, #d4b878 55%, #c49060 100%)',
  badgeBg:      '#e6d8b0',
  badgeBdr:     '#c8aa70',
  badgeText:    '#5a3a10',
  stepDone:     '#b2c5a0',
  stepActive:   '#c49060',
  stepLine:     '#d8c898',
  inputBdr:     '#c4b080',
  inputBg:      '#faf5eb',
  shadow:       '0 2px 10px rgba(100,70,20,0.10)',
  cardHov:      '#e8dcc4',
  pill:         'rgba(178,197,160,0.2)',
};
const NIGHT = {
  bg:           '#0a0a0a',
  sidebar:      '#111828',
  sidebarBdr:   '#1f2a40',
  surface:      '#151d2e',
  surfaceHov:   '#1c2840',
  border:       '#243050',
  accent:       '#d4950a',
  accentDark:   '#b07808',
  accentText:   '#0a0a0a',
  active:       '#d4950a',
  activeBg:     '#1a1608',
  activeBdr:    '#d4950a',
  text:         '#f0f0f0',
  muted:        '#788899',
  faint:        '#3a4a60',
  danger:       '#e05040',
  dangerBg:     '#1a0e0e',
  dangerBdr:    '#6a2020',
  success:      '#3a9060',
  successBg:    '#0e1a12',
  successBdr:   '#2a5a38',
  headerGrad:   'linear-gradient(135deg, #0d0d0d 0%, #151d2e 55%, #d4950a 100%)',
  badgeBg:      '#1f2a3f',
  badgeBdr:     '#2a3a55',
  badgeText:    '#8898bb',
  stepDone:     '#d4950a',
  stepActive:   '#d4950a',
  stepLine:     '#243050',
  inputBdr:     '#243050',
  inputBg:      '#0f1520',
  shadow:       '0 2px 10px rgba(0,0,0,0.45)',
  cardHov:      '#1c2840',
  pill:         'rgba(212,149,10,0.12)',
};

// ── SVG Icons (Feather/Heroicons paths) ───────────────────────────────────────
const Ic = {
  box: (s = 18) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  ),
  upload: (s = 18) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
  ),
  download: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
    </svg>
  ),
  trash: (s = 16) => (
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
  plus: (s = 18) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  sun: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  ),
  moon: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  ),
  search: (s = 15) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  check: (s = 14) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  spark: (s = 22) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.8 5.4L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.6z"/>
      <path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>
      <path d="M5 3l.5 1.5 1.5.5-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z"/>
    </svg>
  ),
  menu: (s = 20) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  ),
  close: (s = 20) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
};

const WIZARD_STEPS = ["Select Product", "Upload Files", "Review & Save"];

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const [filesResult, shopifyRes] = await Promise.all([
    prisma.productFile.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
    }),
    admin.graphql(`#graphql
      query getProducts {
        products(first: 100, sortKey: TITLE) {
          edges { node { id title status featuredImage { url } } }
        }
      }
    `),
  ]);

  // Fire-and-forget: sync product metafields for existing files so the
  // checkout extension can read them via useAppMetafields.
  const uniqueProductIds = [...new Set(filesResult.map((f) => f.productId))];
  for (const pid of uniqueProductIds) {
    const pFiles = filesResult.filter((f) => f.productId === pid);
    const value = JSON.stringify(
      pFiles.map((f) => ({ fileId: f.id, displayName: f.displayName || f.fileName, fileUrl: f.fileUrl }))
    );
    admin.graphql(
      `mutation SyncMetafield($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`,
      { variables: { m: [{ ownerId: pid, namespace: "pendora", key: "files", type: "json", value }] } }
    ).catch((e) => console.error("[Pendora] Metafield sync failed:", e?.message ?? e));
  }

  // Group files by productId
  const productMap = {};
  for (const f of filesResult) {
    if (!productMap[f.productId]) {
      productMap[f.productId] = {
        productId: f.productId,
        productTitle: f.productTitle || "Unknown Product",
        files: [],
      };
    }
    productMap[f.productId].files.push({
      id: f.id,
      fileName: f.fileName,
      displayName: f.displayName || f.fileName,
      fileSize: formatFileSize(f.fileSize),
      createdAt: f.createdAt.toISOString(),
      downloadToken: generateDownloadToken(f.id),
    });
  }

  const digitalProducts = Object.values(productMap);
  const existingIds = new Set(digitalProducts.map((p) => p.productId));

  const shopifyData = await shopifyRes.json();
  const shopifyProducts = shopifyData.data.products.edges.map((e) => ({
    ...e.node,
    alreadyCreated: existingIds.has(e.node.id),
  }));

  return { digitalProducts, shopifyProducts };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const _action = formData.get("_action");

    if (_action === "delete") {
      const fileId = formData.get("fileId");
      if (!fileId) return { error: "No file ID provided." };
      const file = await prisma.productFile.findFirst({ where: { id: fileId, shop } });
      if (!file) return { error: "File not found." };
      await prisma.productFile.delete({ where: { id: fileId } });
      const remaining = await prisma.productFile.findMany({
        where: { shop, productId: file.productId },
        orderBy: { createdAt: "desc" },
      });
      const value = JSON.stringify(
        remaining.map((f) => ({ fileId: f.id, displayName: f.displayName || f.fileName, fileUrl: f.fileUrl }))
      );
      admin.graphql(
        `mutation SyncMetafield($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`,
        { variables: { m: [{ ownerId: file.productId, namespace: "pendora", key: "files", type: "json", value }] } }
      ).catch((e) => console.error("[Pendora] Metafield update after delete failed:", e?.message ?? e));
      return { success: "File deleted." };
    }

    return { error: "Unknown action." };
  } catch (err) {
    if (err instanceof Response) throw err;
    return { error: "Action failed: " + err.message };
  }
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductsPage() {
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = (e) => { setIsMobile(e.matches); if (!e.matches) setSidebarOpen(false); };
    setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const selected = digitalProducts.find((p) => p.productId === selectedId) || null;
  const isDeleting = deleteFetcher.state !== "idle";
  const isBusy = isUploading || isDeleting;

  const selectProduct = (productId) => {
    setSelectedId(productId);
    setMode("view");
    setUploadError(null);
    setUploadSuccess(null);
    if (isMobile) setSidebarOpen(false);
  };

  const openCreate = () => {
    setMode("create");
    setWStep(1);
    setWSearch("");
    setWProduct(null);
    if (isMobile) setSidebarOpen(false);
    setWFiles([]);
    setWError(null);
  };

  const handleUpload = async () => {
    if (isBusy || !selected) return;
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
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
      const saveRes = await fetch("/api/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "save",
          files: [{ resourceUrl: target.resourceUrl, filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, displayName: displayName || file.name }],
          productId: selected.productId,
          productTitle: selected.productTitle,
          downloadEnabled: true,
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || saveData.error) throw new Error(saveData.error || "Failed to save file.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setDisplayName("");
      setUploadSuccess(`"${file.name}" uploaded successfully.`);
      revalidate();
    } catch (err) {
      setUploadError(err.message || "Upload failed.");
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

  const wizardPickFiles = (e) => {
    const newFiles = Array.from(e.target.files || []);
    setWFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...newFiles.filter((f) => !existing.has(f.name + f.size))];
    });
    e.target.value = "";
  };

  const handleWizardSubmit = async () => {
    if (wSubmitting || !wProduct || wFiles.length === 0) return;
    setWSubmitting(true);
    setWError(null);
    try {
      const stageRes = await fetch("/api/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "stage",
          files: wFiles.map((f) => ({ filename: f.name, mimeType: f.type || "application/octet-stream", fileSize: f.size })),
        }),
      });
      const stageData = await stageRes.json();
      if (!stageRes.ok || stageData.error) throw new Error(stageData.error || "Failed to prepare upload.");
      const uploaded = [];
      for (let i = 0; i < wFiles.length; i++) {
        const file = wFiles[i];
        const target = stageData.targets[i];
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", target.url);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.timeout = 300000;
          xhr.ontimeout = () => reject(new Error(`Timed out uploading "${file.name}".`));
          xhr.onerror = () => reject(new Error(`Network error uploading "${file.name}".`));
          xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`Upload failed for "${file.name}" (${xhr.status}).`));
          xhr.send(file);
        });
        uploaded.push({ resourceUrl: target.resourceUrl, filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, displayName: file.name });
      }
      const saveRes = await fetch("/api/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "save", files: uploaded, productId: wProduct.id, productTitle: wProduct.title, downloadEnabled: true }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || saveData.error) throw new Error(saveData.error || "Failed to save files.");
      setSelectedId(wProduct.id);
      setMode("view");
      revalidate();
    } catch (err) {
      setWError(err.message || "Something went wrong.");
    } finally {
      setWSubmitting(false);
    }
  };

  const filteredShopify = shopifyProducts.filter((p) =>
    p.title.toLowerCase().includes(wSearch.toLowerCase())
  );

  // ── Theme helpers ──────────────────────────────────────────────────────────
  const btn = (variant, extra = {}) => {
    const base = { border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", transition: "opacity 0.15s", ...extra };
    if (variant === "primary")   return { ...base, background: `linear-gradient(135deg, ${t.accent}, ${t.active})`, color: "#fff", padding: "8px 18px" };
    if (variant === "secondary") return { ...base, background: t.surface, color: t.text, border: `1px solid ${t.border}`, padding: "7px 14px" };
    if (variant === "danger")    return { ...base, background: t.dangerBg, color: t.danger, border: `1px solid ${t.dangerBdr}`, padding: "7px 12px" };
    if (variant === "ghost")     return { ...base, background: "transparent", color: t.muted, border: `1px solid ${t.border}`, padding: "7px 14px" };
    return base;
  };

  const input = { padding: "8px 12px", border: `1px solid ${t.inputBdr}`, borderRadius: "8px", background: t.inputBg, color: t.text, fontSize: "14px", outline: "none", width: "100%", boxSizing: "border-box" };

  // ── Header bar ─────────────────────────────────────────────────────────────
  const headerBar = (
    <div style={{ background: t.headerGrad, padding: isMobile ? "10px 14px" : "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 -20px", boxShadow: "0 2px 12px rgba(0,0,0,0.18)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {isMobile && (
          <button onClick={() => setSidebarOpen((v) => !v)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center" }}>
            {sidebarOpen ? Ic.close(22) : Ic.menu(22)}
          </button>
        )}
        <div style={{ width: 36, height: 36, borderRadius: "10px", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
          {Ic.spark(20)}
        </div>
        {!isMobile && <div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: "18px", letterSpacing: "-0.3px", lineHeight: 1.1 }}>Pendora</div>
          <div style={{ color: "rgba(255,255,255,0.72)", fontSize: "11px", fontWeight: 400, letterSpacing: "0.4px" }}>DIGITAL PRODUCTS</div>
        </div>}
      </div>
      <button onClick={() => setIsDark((d) => !d)} style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: "20px", padding: "6px 14px", color: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 600, backdropFilter: "blur(4px)" }}>
        {isDark ? Ic.sun(14) : Ic.moon(14)}
        {isDark ? "Day Mode" : "Night Mode"}
      </button>
    </div>
  );

  // ── Empty state ────────────────────────────────────────────────────────────
  if (digitalProducts.length === 0 && mode !== "create") {
    return (
      <s-page heading="Digital Products">
        <div style={{ background: t.bg, color: t.text, margin: "0 -20px -20px", minHeight: "calc(100vh - 100px)" }}>
          {headerBar}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 24px", textAlign: "center", gap: "20px" }}>
            <div style={{ width: 80, height: 80, borderRadius: "20px", background: isDark ? "rgba(212,149,10,0.12)" : "rgba(178,197,160,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: t.accent }}>
              {Ic.box(40)}
            </div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: t.text }}>No digital products yet</div>
            <div style={{ fontSize: "14px", color: t.muted, maxWidth: "360px", lineHeight: 1.6 }}>
              Create your first digital product to sell downloadable files with your orders.
            </div>
            <button onClick={openCreate} style={btn("primary", { padding: "10px 24px", fontSize: "14px", borderRadius: "10px" })}>
              {Ic.plus(16)} Add Digital Product
            </button>
          </div>
        </div>
      </s-page>
    );
  }

  if (digitalProducts.length === 0 && mode === "create") {
    return (
      <s-page heading="Digital Products">
        <div style={{ background: t.bg, color: t.text, margin: "0 -20px -20px", minHeight: "calc(100vh - 100px)" }}>
          {headerBar}
          <div style={{ padding: "28px 32px" }}>
            <WizardPanel t={t} btn={btn} input={input} isDark={isDark}
              step={wStep} setStep={setWStep} search={wSearch} setSearch={setWSearch}
              wProduct={wProduct} setWProduct={setWProduct} wFiles={wFiles} setWFiles={setWFiles}
              wSubmitting={wSubmitting} wError={wError} filteredShopify={filteredShopify}
              wizardFileInputRef={wizardFileInputRef} wizardPickFiles={wizardPickFiles}
              handleWizardSubmit={handleWizardSubmit} onCancel={() => setMode("view")}
            />
          </div>
        </div>
      </s-page>
    );
  }

  // ── Main 2-column layout ───────────────────────────────────────────────────
  return (
    <s-page heading="Digital Products">
      <div style={{ background: t.bg, color: t.text, margin: "0 -20px -20px", minHeight: "calc(100vh - 100px)" }}>
        {headerBar}

        <div style={{ display: "flex", minHeight: "calc(100vh - 180px)", position: "relative" }}>

          {/* Sidebar overlay backdrop (mobile) */}
          {isMobile && sidebarOpen && (
            <div onClick={() => setSidebarOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 90 }} />
          )}

          {/* ── Left Sidebar ── */}
          <div style={{ width: isMobile ? "280px" : "270px", flexShrink: 0, background: t.sidebar, borderRight: `1px solid ${t.sidebarBdr}`, display: "flex", flexDirection: "column", ...(isMobile ? { position: "absolute", top: 0, bottom: 0, left: 0, zIndex: 95, transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform 0.25s ease", boxShadow: sidebarOpen ? "4px 0 20px rgba(0,0,0,0.25)" : "none" } : {}) }}>
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${t.sidebarBdr}` }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: t.muted, textTransform: "uppercase", letterSpacing: "0.8px" }}>Your Products</div>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {digitalProducts.map((p) => {
                const isActive = p.productId === selectedId && mode === "view";
                return (
                  <div key={p.productId} onClick={() => selectProduct(p.productId)} style={{ padding: "12px 14px", borderBottom: `1px solid ${t.sidebarBdr}`, background: isActive ? t.activeBg : "transparent", borderLeft: `3px solid ${isActive ? t.activeBdr : "transparent"}`, cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", transition: "background 0.12s" }}>
                    <div style={{ width: 34, height: 34, borderRadius: "9px", background: isActive ? (isDark ? "rgba(212,149,10,0.2)" : "rgba(196,144,96,0.15)") : t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: isActive ? t.active : t.accent, flexShrink: 0 }}>
                      {Ic.box(17)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "13px", color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.productTitle}</div>
                      <span style={{ fontSize: "11px", fontWeight: 600, background: t.badgeBg, color: t.badgeText, padding: "1px 8px", borderRadius: "10px", border: `1px solid ${t.badgeBdr}`, marginTop: "3px", display: "inline-block" }}>
                        {p.files.length} {p.files.length === 1 ? "file" : "files"}
                      </span>
                    </div>
                    {isActive && <div style={{ color: t.active, flexShrink: 0 }}>{Ic.check(13)}</div>}
                  </div>
                );
              })}
            </div>
            {/* Add New button */}
            <div onClick={openCreate} style={{ padding: "14px 16px", borderTop: `1px solid ${t.sidebarBdr}`, background: mode === "create" ? (isDark ? "rgba(212,149,10,0.08)" : "rgba(196,144,96,0.08)") : "transparent", borderLeft: `3px solid ${mode === "create" ? t.activeBdr : "transparent"}`, cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", color: t.accent, fontWeight: 600, fontSize: "13px", transition: "background 0.12s" }}>
              <div style={{ width: 34, height: 34, borderRadius: "9px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {Ic.plus(16)}
              </div>
              Add New Product
            </div>
          </div>

          {/* ── Right Panel ── */}
          <div style={{ flex: 1, overflowY: "auto", background: t.bg, padding: "0" }}>

            {/* Create Wizard */}
            {mode === "create" && (
              <div style={{ padding: "28px 32px" }}>
                <WizardPanel t={t} btn={btn} input={input} isDark={isDark}
                  step={wStep} setStep={setWStep} search={wSearch} setSearch={setWSearch}
                  wProduct={wProduct} setWProduct={setWProduct} wFiles={wFiles} setWFiles={setWFiles}
                  wSubmitting={wSubmitting} wError={wError} filteredShopify={filteredShopify}
                  wizardFileInputRef={wizardFileInputRef} wizardPickFiles={wizardPickFiles}
                  handleWizardSubmit={handleWizardSubmit} onCancel={() => setMode("view")}
                />
              </div>
            )}

            {/* No selection */}
            {mode === "view" && !selected && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "12px", color: t.muted, padding: isMobile ? "40px 16px" : "60px 20px", textAlign: "center" }}>
                {Ic.box(36)}
                <div style={{ fontSize: "14px" }}>{isMobile ? "Tap the menu icon to select a product" : "Select a product from the sidebar"}</div>
              </div>
            )}

            {/* Product Detail */}
            {mode === "view" && selected && (
              <div style={{ padding: isMobile ? "16px 12px" : "28px 32px" }}>

                {/* Product Header */}
                <div style={{ marginBottom: "24px", paddingBottom: "18px", borderBottom: `2px solid ${t.border}`, display: "flex", alignItems: "center", gap: "14px" }}>
                  <div style={{ width: 44, height: 44, borderRadius: "12px", background: isDark ? "rgba(212,149,10,0.15)" : "rgba(178,197,160,0.3)", display: "flex", alignItems: "center", justifyContent: "center", color: t.accent }}>
                    {Ic.box(22)}
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: t.text }}>{selected.productTitle}</h2>
                    <div style={{ fontSize: "12px", color: t.muted, marginTop: "2px" }}>{selected.files.length} attached {selected.files.length === 1 ? "file" : "files"}</div>
                  </div>
                </div>

                {/* Upload in progress */}
                {isUploading && (
                  <div style={{ padding: "12px 16px", marginBottom: "20px", background: isDark ? "rgba(212,149,10,0.1)" : "rgba(178,197,160,0.2)", border: `1px solid ${t.accent}`, borderRadius: "10px", color: t.accent, fontWeight: 600, display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "18px" }}>⏳</span> Uploading… please wait.
                  </div>
                )}

                {/* Upload Card */}
                <div style={{ background: t.surface, border: `2px dashed ${t.border}`, borderRadius: "14px", padding: "24px", marginBottom: "20px", boxShadow: t.shadow }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                    <div style={{ color: t.accent }}>{Ic.upload(20)}</div>
                    <div style={{ fontWeight: 700, fontSize: "13px", color: t.text, textTransform: "uppercase", letterSpacing: "0.6px" }}>Upload File</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div>
                      <label style={{ display: "block", marginBottom: "5px", fontWeight: 600, fontSize: "13px", color: t.muted }}>Select File</label>
                      <input ref={fileInputRef} type="file" disabled={isBusy}
                        accept=".pdf,.zip,.mp3,.mp4,.png,.jpg,.jpeg,.gif,.webp,.mov,.epub,.docx,.xlsx"
                        style={{ color: t.text, fontSize: "13px", opacity: isBusy ? 0.5 : 1 }} />
                      <div style={{ fontSize: "11px", color: t.faint, marginTop: "4px" }}>Max 5 GB — PDF, ZIP, MP3, MP4, PNG, JPG, GIF, EPUB, DOCX, XLSX</div>
                    </div>
                    <div>
                      <label style={{ display: "block", marginBottom: "5px", fontWeight: 600, fontSize: "13px", color: t.muted }}>Display Name</label>
                      <input type="text" value={displayName} disabled={isBusy}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="e.g. User Guide PDF"
                        style={{ ...input, width: isMobile ? "100%" : "280px", maxWidth: "100%", opacity: isBusy ? 0.5 : 1 }} />
                    </div>
                    <div>
                      <button disabled={isBusy} onClick={handleUpload} style={btn("primary", { opacity: isBusy ? 0.6 : 1, borderRadius: "10px" })}>
                        {Ic.upload(15)} {isUploading ? "Uploading…" : "Upload File"}
                      </button>
                    </div>
                    {uploadError && <div style={{ padding: "10px 14px", background: t.dangerBg, border: `1px solid ${t.dangerBdr}`, borderRadius: "8px", color: t.danger, fontSize: "13px" }}>{uploadError}</div>}
                    {uploadSuccess && <div style={{ padding: "10px 14px", background: t.successBg, border: `1px solid ${t.successBdr}`, borderRadius: "8px", color: t.success, fontSize: "13px" }}>✓ {uploadSuccess}</div>}
                  </div>
                </div>

                {/* Files List */}
                <div style={{ background: t.surface, borderRadius: "14px", border: `1px solid ${t.border}`, overflow: "hidden", boxShadow: t.shadow }}>
                  <div style={{ padding: "14px 18px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ color: t.accent }}>{Ic.file(16)}</div>
                    <span style={{ fontWeight: 700, fontSize: "12px", color: t.muted, textTransform: "uppercase", letterSpacing: "0.6px" }}>Attached Files ({selected.files.length})</span>
                  </div>
                  {deleteFetcher.data?.error && (
                    <div style={{ padding: "10px 18px", background: t.dangerBg, color: t.danger, fontSize: "13px", borderBottom: `1px solid ${t.dangerBdr}` }}>{deleteFetcher.data.error}</div>
                  )}
                  {selected.files.length === 0 ? (
                    <div style={{ padding: "32px", textAlign: "center", color: t.faint, fontSize: "14px" }}>No files yet. Upload one above.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                      {selected.files.map((file, idx) => (
                        <div key={file.id} style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", padding: isMobile ? "12px 14px" : "14px 18px", gap: isMobile ? "10px" : "0", borderBottom: idx < selected.files.length - 1 ? `1px solid ${t.border}` : "none", opacity: isBusy ? 0.6 : 1, transition: "background 0.12s" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                            <div style={{ width: 38, height: 38, borderRadius: "10px", background: isDark ? "rgba(212,149,10,0.12)" : "rgba(178,197,160,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: t.accent, flexShrink: 0 }}>
                              {Ic.file(20)}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: "14px", color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.displayName}</div>
                              {file.displayName !== file.fileName && <div style={{ fontSize: "11px", color: t.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.fileName}</div>}
                              <div style={{ fontSize: "11px", color: t.muted, marginTop: "1px" }}>{file.fileSize} · {new Date(file.createdAt).toLocaleDateString()}</div>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: "8px", ...(isMobile ? { marginLeft: "50px" } : {}) }}>
                            <a href={`/api/files/${file.id}?token=${file.downloadToken}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                              <button disabled={isBusy} style={btn("secondary")}>
                                {Ic.download(14)} Preview
                              </button>
                            </a>
                            <button disabled={isBusy} onClick={() => handleDelete(file.id)} style={btn("danger")}>
                              {Ic.trash(14)} {isDeleting ? "…" : "Delete"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
    </s-page>
  );
}

// ─── Wizard Panel ─────────────────────────────────────────────────────────────

function WizardPanel({ t, btn, input, isDark, step, setStep, search, setSearch, wProduct, setWProduct, wFiles, setWFiles, wSubmitting, wError, filteredShopify, wizardFileInputRef, wizardPickFiles, handleWizardSubmit, onCancel }) {
  return (
    <div style={{ maxWidth: "640px" }}>

      {/* Step indicators */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: "32px" }}>
        {WIZARD_STEPS.map((label, i) => {
          const num = i + 1;
          const isActive = step === num;
          const isDone = step > num;
          const dotBg = isDone ? t.stepDone : isActive ? t.stepActive : t.border;
          const dotColor = (isDone || isActive) ? (isDark && isActive ? "#0a0a0a" : "#fff") : t.muted;
          return (
            <div key={num} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: dotBg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px", color: dotColor, boxShadow: isActive ? `0 0 0 4px ${isDark ? "rgba(212,149,10,0.2)" : "rgba(196,144,96,0.2)"}` : "none", transition: "all 0.2s" }}>
                  {isDone ? Ic.check(13) : num}
                </div>
                <span style={{ fontSize: "11px", marginTop: "6px", color: isActive ? t.text : t.muted, fontWeight: isActive ? 700 : 400, whiteSpace: "nowrap" }}>{label}</span>
              </div>
              {i < WIZARD_STEPS.length - 1 && (
                <div style={{ flex: 1, height: "2px", background: step > num ? t.stepDone : t.stepLine, margin: "0 8px", marginBottom: "18px", borderRadius: "2px", transition: "background 0.2s" }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step 1: Select Product */}
      {step === 1 && (
        <div>
          <div style={{ fontWeight: 700, fontSize: "16px", color: t.text, marginBottom: "14px" }}>Choose a product</div>
          <div style={{ position: "relative", marginBottom: "14px" }}>
            <span style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: t.muted }}>{Ic.search(15)}</span>
            <input type="text" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ ...input, paddingLeft: "34px" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "340px", overflowY: "auto", paddingRight: "4px" }}>
            {filteredShopify.length === 0 ? (
              <div style={{ color: t.muted, fontSize: "14px", padding: "20px", textAlign: "center" }}>No products found.</div>
            ) : filteredShopify.map((product) => {
              const isSelected = wProduct?.id === product.id;
              return (
                <div key={product.id} onClick={() => !product.alreadyCreated && setWProduct(product)}
                  style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", border: `2px solid ${isSelected ? t.active : product.alreadyCreated ? t.border : t.border}`, borderRadius: "10px", background: isSelected ? t.activeBg : t.surface, cursor: product.alreadyCreated ? "default" : "pointer", opacity: product.alreadyCreated ? 0.55 : 1, transition: "all 0.12s" }}>
                  {product.featuredImage?.url ? (
                    <img src={product.featuredImage.url} alt={product.title} style={{ width: 38, height: 38, objectFit: "cover", borderRadius: "8px", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 38, height: 38, background: t.pill, borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", color: t.accent, flexShrink: 0 }}>{Ic.box(18)}</div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: t.text }}>{product.title}</div>
                    <div style={{ fontSize: "12px", color: t.muted, textTransform: "capitalize" }}>{product.status.toLowerCase()}</div>
                  </div>
                  {product.alreadyCreated && <span style={{ fontSize: "11px", background: t.badgeBg, color: t.badgeText, padding: "2px 8px", borderRadius: "10px", border: `1px solid ${t.badgeBdr}`, fontWeight: 600 }}>Added</span>}
                  {isSelected && !product.alreadyCreated && <div style={{ color: t.active }}>{Ic.check(16)}</div>}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
            <button onClick={onCancel} style={btn("ghost")}>Cancel</button>
            <button disabled={!wProduct} onClick={() => wProduct && setStep(2)} style={btn("primary", { opacity: wProduct ? 1 : 0.5 })}>
              Upload Files →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Upload Files */}
      {step === 2 && (
        <div>
          <div style={{ fontWeight: 700, fontSize: "16px", color: t.text, marginBottom: "4px" }}>Upload files</div>
          <div style={{ fontSize: "13px", color: t.muted, marginBottom: "16px" }}>For "{wProduct?.title}"</div>
          <input ref={wizardFileInputRef} type="file" multiple style={{ display: "none" }} onChange={wizardPickFiles} />
          <button onClick={() => wizardFileInputRef.current?.click()} style={btn("secondary", { marginBottom: "8px" })}>
            {Ic.plus(15)} Add Files
          </button>
          <div style={{ fontSize: "11px", color: t.faint, marginBottom: "14px" }}>Max 5 GB — PDF, ZIP, MP3, MP4, PNG, JPG, GIF, EPUB, DOCX, XLSX</div>
          {wFiles.length === 0 ? (
            <div style={{ padding: "32px", border: `2px dashed ${t.border}`, borderRadius: "12px", textAlign: "center", color: t.muted, fontSize: "14px", marginBottom: "18px", background: t.surface }}>
              <div style={{ marginBottom: "6px", color: t.accent }}>{Ic.upload(28)}</div>
              No files selected. Click "+ Add Files".
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
              {wFiles.map((file, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", border: `1px solid ${t.border}`, borderRadius: "10px", background: t.surface }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ color: t.accent }}>{Ic.file(16)}</div>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: "13px", color: t.text }}>{file.name}</div>
                      <div style={{ fontSize: "11px", color: t.muted }}>{formatFileSize(file.size)}</div>
                    </div>
                  </div>
                  <button onClick={() => setWFiles((prev) => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: t.muted, cursor: "pointer", fontSize: "20px", padding: "0 4px", lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => setStep(1)} style={btn("ghost")}>← Back</button>
            <button disabled={wFiles.length === 0} onClick={() => wFiles.length > 0 && setStep(3)} style={btn("primary", { opacity: wFiles.length > 0 ? 1 : 0.5 })}>
              Review →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Save */}
      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {wSubmitting && (
            <div style={{ padding: "12px 16px", background: isDark ? "rgba(212,149,10,0.1)" : "rgba(178,197,160,0.2)", border: `1px solid ${t.accent}`, borderRadius: "10px", color: t.accent, fontWeight: 600, display: "flex", alignItems: "center", gap: "10px" }}>
              <span>⏳</span> Uploading & saving… please wait.
            </div>
          )}
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", padding: "18px", opacity: wSubmitting ? 0.6 : 1 }}>
            <div style={{ fontWeight: 700, fontSize: "13px", color: t.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "14px" }}>Summary</div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <div style={{ color: t.accent }}>{Ic.box(16)}</div>
              <div style={{ fontSize: "14px", color: t.text }}><span style={{ color: t.muted }}>Product: </span><strong>{wProduct?.title}</strong></div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
              <div style={{ color: t.accent, marginTop: "1px" }}>{Ic.file(16)}</div>
              <div style={{ fontSize: "14px", color: t.text }}>
                <span style={{ color: t.muted }}>Files ({wFiles.length}): </span>
                <strong>{wFiles.map((f) => f.name).join(", ")}</strong>
              </div>
            </div>
          </div>
          {wError && <div style={{ padding: "10px 14px", background: t.dangerBg, border: `1px solid ${t.dangerBdr}`, borderRadius: "8px", color: t.danger, fontSize: "13px" }}>{wError}</div>}
          <div style={{ display: "flex", gap: "10px" }}>
            <button disabled={wSubmitting} onClick={() => setStep(2)} style={btn("ghost", { opacity: wSubmitting ? 0.5 : 1 })}>← Back</button>
            <button disabled={wSubmitting} onClick={handleWizardSubmit} style={btn("primary", { opacity: wSubmitting ? 0.7 : 1, padding: "10px 24px" })}>
              {wSubmitting ? "Saving…" : "✓ Create Digital Product"}
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
  const message = isRouteErrorResponse(error)
    ? (error.data?.message || error.statusText || "An error occurred.")
    : error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <s-page heading="Something went wrong">
      <s-section>
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          {statusCode && <p style={{ fontSize: "48px", fontWeight: 700, color: "#d72c0d", margin: "0 0 8px 0" }}>{statusCode}</p>}
          <p style={{ color: "#6d7175", marginBottom: "24px" }}>{message}</p>
          <s-button onClick={() => window.location.reload()}>Reload Page</s-button>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
