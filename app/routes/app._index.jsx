import { useState, useRef, useEffect } from "react";
import { useLoaderData, useFetcher, useRevalidator, useNavigate, useRouteError, isRouteErrorResponse } from "react-router";
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

function getFileType(filename) {
  if (!filename) return "—";
  const ext = filename.split(".").pop();
  return ext && ext !== filename ? ext.toUpperCase() : "—";
}

// ── Shopify-matched: Light Steel grays + Navy/Amber accents ───────────────────
const DAY = {
  headerBg:   '#1B2B44',
  bg:         '#F6F6F7',
  sidebar:    '#FFFFFF',
  sidebarBdr: '#E1E3E5',
  surface:    '#FFFFFF',
  border:     '#E1E3E5',
  accent:     '#F5A524',
  accentText: '#FFFFFF',
  active:     '#1B2B44',
  activeBg:   '#F0F1F2',
  activeBdr:  '#1B2B44',
  text:       '#303030',
  muted:      '#6D7175',
  faint:      '#999EA3',
  danger:     '#D72C0D',
  dangerBg:   '#FFF4F4',
  dangerBdr:  '#FDBDBD',
  success:    '#008060',
  successBg:  '#F1F8F5',
  successBdr: '#AEE9D1',
  badgeBg:    '#E4E5E7',
  badgeBdr:   '#C9CCCF',
  badgeText:  '#6D7175',
  stepDone:   '#1B2B44',
  stepActive: '#F5A524',
  stepLine:   '#E1E3E5',
  inputBdr:   '#C9CCCF',
  inputBg:    '#FFFFFF',
  shadow:     '0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
  pill:       'rgba(27,43,68,0.07)',
};

// ── Upload chunking constants ─────────────────────────────────────────────────
const CHUNK_SIZE      = 25 * 1024 * 1024;  // 25 MB per chunk
const CHUNK_THRESHOLD = 50 * 1024 * 1024;  // only chunk files > 50 MB
const MAX_PARALLEL    = 6;                  // concurrent XHR uploads

// ── Resume cache helpers (localStorage) ───────────────────────────────────────
const RESUME_MAX_AGE = 60 * 60 * 1000; // 60 minutes

function resumeCacheKey(productId, files) {
  return `pendora_upload_${productId}_${files.map(f => f.name + f.size).join("|")}`;
}
function loadResumeCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > RESUME_MAX_AGE) { localStorage.removeItem(key); return null; }
    return data.done || null;
  } catch { return null; }
}
function saveResumeCache(key, files, done) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), files: files.map(f => ({ name: f.name, size: f.size })), done })); } catch {}
}

/** Runs up to `limit` async task-factories concurrently, filling slots as each completes. */
async function withConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) { const i = idx++; results[i] = await tasks[i](); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ── Transition helpers (left-to-right staggered sweep) ────────────────────────
const TR  = "background 0.38s ease, color 0.35s ease, border-color 0.3s ease, box-shadow 0.38s ease";
const TRD = "background 0.38s ease 0.12s, color 0.35s ease 0.12s, border-color 0.3s ease 0.12s, box-shadow 0.38s ease 0.12s";

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

  // ── Fast path: only SQLite — always < 100 ms ──────────────────────────────
  const filesResult = await prisma.productFile.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });

  const productMap = {};
  for (const f of filesResult) {
    if (!productMap[f.productId]) {
      productMap[f.productId] = { productId: f.productId, productTitle: f.productTitle || "Unknown Product", files: [] };
    }
    productMap[f.productId].files.push({ id: f.id, fileName: f.fileName, displayName: f.displayName || f.fileName, fileSize: formatFileSize(f.fileSize), status: f.status || "ready", createdAt: f.createdAt.toISOString(), downloadToken: generateDownloadToken(f.id) });
  }

  // Fire-and-forget metafield sync so checkout extension stays up to date.
  // Not awaited — never blocks the response.
  const uniqueProductIds = [...new Set(filesResult.map((f) => f.productId))];
  for (const pid of uniqueProductIds) {
    const pFiles = filesResult.filter((f) => f.productId === pid);
    const value = JSON.stringify(pFiles.map((f) => ({ fileId: f.id, displayName: f.displayName || f.fileName, fileUrl: f.fileUrl })));
    admin.graphql(
      `mutation SyncMetafield($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`,
      { variables: { m: [{ ownerId: pid, namespace: "pendora", key: "files", type: "json", value }] } }
    ).catch((e) => console.error("[Pendora] Metafield sync failed:", e?.message ?? e));
  }

  // shopifyProducts are NOT loaded here — they are lazy-loaded by the client
  // via /api/products (with caching) only when the wizard opens.
  return { digitalProducts: Object.values(productMap) };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const _action = formData.get("_action");

    if (_action === "deleteFile") {
      const fileId = (formData.get("fileId") || "").trim();
      if (!fileId) return { error: "No file ID provided." };
      // findFirst to get productId for metafield sync
      const file = await prisma.productFile.findFirst({ where: { id: fileId, shop } });
      if (!file) return { success: "File deleted." }; // already gone — optimistic delete is correct
      // deleteMany never throws P2025 — returns { count: 0 } if already gone.
      // Avoids SQLite lock conflicts with the background CDN polling process.
      await prisma.productFile.deleteMany({ where: { id: fileId, shop } });
      const remaining = await prisma.productFile.findMany({ where: { shop, productId: file.productId }, orderBy: { createdAt: "desc" } });
      const value = JSON.stringify(remaining.map((f) => ({ fileId: f.id, displayName: f.displayName || f.fileName, fileUrl: f.fileUrl })));
      admin.graphql(
        `mutation SyncMetafield($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`,
        { variables: { m: [{ ownerId: file.productId, namespace: "pendora", key: "files", type: "json", value }] } }
      ).catch(() => {});
      return { success: "File deleted." };
    }

    if (_action === "deleteProduct") {
      const productId = formData.get("productId");
      if (!productId) return { error: "No product ID provided." };
      await prisma.productFile.deleteMany({ where: { shop, productId } });
      // Clear metafield fire-and-forget
      admin.graphql(
        `mutation SyncMetafield($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } } }`,
        { variables: { m: [{ ownerId: productId, namespace: "pendora", key: "files", type: "json", value: "[]" }] } }
      ).catch(() => {});
      return { success: "Product deleted." };
    }

    return { error: "Unknown action." };
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("[Pendora] Action error:", err?.message ?? err);
    return { error: "Something went wrong. Please refresh and try again." };
  }
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { digitalProducts } = useLoaderData();
  const deleteFetcher = useFetcher();
  const productDeleteFetcher = useFetcher();
  const shopifyFetcher = useFetcher(); // lazy-loads /api/products only when wizard opens
  const { revalidate, state: revalidateState } = useRevalidator();
  const navigate = useNavigate();
  const pendingRevalidate = useRef(false);

  const t = DAY;

  const [mode, setMode] = useState("view");
  const [selectedId, setSelectedId] = useState(() => digitalProducts[0]?.productId || null);
  const fileInputRef = useRef(null);
  const prestageRef = useRef(null);    // { name, size, promise } — pre-fetched presigned URL for single upload
  const wPrestageRef = useRef(null);   // { files:[{name,size}], promise } — pre-fetched for wizard
  const [displayName, setDisplayName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingProductId, setUploadingProductId] = useState(null); // which product's upload is active
  const [uploadProgress, setUploadProgress] = useState(0);   // 0–100
  const [uploadSpeedBps, setUploadSpeedBps] = useState(null); // bytes/sec
  const [uploadEta, setUploadEta] = useState(null);           // seconds remaining
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const wizardFileInputRef = useRef(null);
  const [wStep, setWStep] = useState(1);
  const [wSearch, setWSearch] = useState("");
  const [wProduct, setWProduct] = useState(null);
  const [wFiles, setWFiles] = useState([]);
  const [wExisting, setWExisting] = useState([]);  // existing files selected for cloning
  const [wSubmitting, setWSubmitting] = useState(false);
  const [wError, setWError] = useState(null);
  const [wCanRetry, setWCanRetry] = useState(false);       // show Retry button instead of Create
  const [wProgressText, setWProgressText] = useState("");   // "0%" → "33%" → "100%"
  const wDonePartsRef = useRef({});
  const wChunkBytesRef = useRef({});                         // { [partIndex]: bytesLoaded } — smooth progress
  const wTotalBytesRef = useRef(0);                          // { [partIndex]: resourceUrl } — survives retries

  // Optimistic delete — IDs removed from UI instantly, no revalidate needed
  const [deletedFileIds, setDeletedFileIds] = useState(new Set());
  const [deletedProductIds, setDeletedProductIds] = useState(new Set());
  const [pendingDeleteProductId, setPendingDeleteProductId] = useState(null); // tracks in-flight product delete
  const [productDeleteError, setProductDeleteError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name, fileCount }
  const [fileDeleteError, setFileDeleteError] = useState(null);

  // Show file-delete error briefly then auto-clear
  useEffect(() => {
    if (!deleteFetcher.data?.error) return;
    setFileDeleteError(deleteFetcher.data.error);
    const t = setTimeout(() => setFileDeleteError(null), 5000);
    return () => clearTimeout(t);
  }, [deleteFetcher.data]);

  // Product delete: rollback optimistic delete if action failed
  useEffect(() => {
    if (productDeleteFetcher.state !== "idle" || !pendingDeleteProductId) return;
    if (productDeleteFetcher.data?.error) {
      // Rollback — put the product back
      setDeletedProductIds((prev) => {
        const n = new Set(prev);
        n.delete(pendingDeleteProductId);
        return n;
      });
      setProductDeleteError("Could not delete product. Please try again.");
      const t = setTimeout(() => setProductDeleteError(null), 5000);
      setPendingDeleteProductId(null);
      return () => clearTimeout(t);
    }
    setPendingDeleteProductId(null);
  }, [productDeleteFetcher.state, productDeleteFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const isRevalidating = revalidateState === "loading";
  // Show skeleton only when revalidating AND the selected product is the one that just uploaded
  // (or no product is selected). If the user is viewing a different product, skip skeleton.
  const showSkeleton = (revalidating, sel) =>
    revalidating && (mode === "view" || mode === "detail") && (!sel || sel.productId === uploadingProductId);

  // Compute visible lists with optimistic deletes applied
  const visibleProducts = digitalProducts
    .filter((p) => !deletedProductIds.has(p.productId))
    .map((p) => ({ ...p, files: p.files.filter((f) => !deletedFileIds.has(f.id)) }));

  const selected = visibleProducts.find((p) => p.productId === selectedId) || null;
  // isBusy is per-product — only the product currently uploading is locked
  const isBusy = isUploading && uploadingProductId === selected?.productId;

  // Fallback: if detail mode but product no longer exists, go back to list
  useEffect(() => {
    if (mode === "detail" && !selected) setMode("view");
  }, [mode, selected]);

  // Deferred revalidation — navigate to same route forces a fresh loader run
  useEffect(() => {
    if (pendingRevalidate.current && mode === "view") {
      pendingRevalidate.current = false;
      navigate(".", { replace: true });
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectProduct = (id) => { setSelectedId(id); setMode("detail"); setUploadError(null); setUploadSuccess(null); };
  const openCreate = () => { setMode("create"); setWStep(1); setWSearch(""); setWProduct(null); setWFiles([]); setWExisting([]); setWError(null); };

  // Pre-fetch Shopify products on page load — by the time user clicks
  // "Add Product", the list is already cached and wizard opens instantly.
  useEffect(() => {
    if (shopifyFetcher.state === "idle" && !shopifyFetcher.data) {
      shopifyFetcher.load("/api/products");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fire /api/stage immediately when user picks a file — so the presigned URL
  // is already ready by the time they click "Upload File".
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file || !selected) { prestageRef.current = null; return; }
    const promise = fetch("/api/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "stage", files: [{ filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size }] }),
    })
      .then((r) => r.json())
      .then((sd) => (!sd.error && sd.targets?.[0]) ? sd.targets[0] : null)
      .catch(() => null);
    prestageRef.current = { name: file.name, size: file.size, promise };
  };

  const singleDonePartsRef = useRef({});  // resume cache for single-file chunked upload

  const handleUpload = async () => {
    if (isUploading || !selected) return;
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setUploadingProductId(selected.productId);
    setUploadProgress(0); setUploadSpeedBps(null); setUploadEta(null);
    setUploadError(null); setUploadSuccess(null);
    try {
      const needsChunking = file.size > CHUNK_THRESHOLD;
      const totalBytes = file.size;
      let lastSpeedLoaded = 0; let lastSpeedTime = Date.now();

      /** JIT stage + upload one part with retry (shared by single and chunked paths) */
      const stageAndUpload = async (stageMeta, blob, partIndex, totalParts, doneRef, onProgress) => {
        if (doneRef.current[partIndex]) return doneRef.current[partIndex];
        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const sr = await fetch("/api/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "stage", files: [stageMeta] }) });
            const sd = await sr.json();
            if (!sr.ok || sd.error) throw new Error(sd.error || "Stage failed.");
            const target = sd.targets[0];
            await new Promise((res, rej) => {
              const xhr = new XMLHttpRequest(); xhr.open("PUT", target.url);
              if (target.parameters?.length) { for (const p of target.parameters) { try { xhr.setRequestHeader(p.name, p.value); } catch {} } }
              if (!target.parameters?.some(p => p.name.toLowerCase() === "content-type")) { xhr.setRequestHeader("Content-Type", stageMeta.mimeType); }
              xhr.timeout = 0;
              if (onProgress) xhr.upload.onprogress = onProgress;
              xhr.onerror = () => rej(new Error("Network error"));
              xhr.onabort = () => rej(new Error("Cancelled"));
              xhr.onload = () => xhr.status < 300 ? res() : rej(new Error(`HTTP ${xhr.status}`));
              xhr.send(blob);
            });
            doneRef.current[partIndex] = target.resourceUrl;
            console.log(`[Pendora] Part ${partIndex + 1}/${totalParts} OK (attempt ${attempt})`);
            return target.resourceUrl;
          } catch (err) {
            console.warn(`[Pendora] Part ${partIndex + 1} attempt ${attempt}/${MAX_RETRIES}: ${err.message}`);
            if (attempt === MAX_RETRIES) throw new Error(`Failed after ${MAX_RETRIES} retries: "${file.name}" part ${partIndex}`);
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      };

      if (!needsChunking) {
        // ── Small file: single JIT upload with retry ──────────────────────
        console.log(`[Pendora] Single upload: "${file.name}" (${file.size} bytes)`);
        const meta = { filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size };
        const onProg = (e) => {
          if (!e.lengthComputable) return;
          const now = Date.now(); const elapsed = (now - lastSpeedTime) / 1000;
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
          if (elapsed >= 0.8) {
            const speed = (e.loaded - lastSpeedLoaded) / elapsed;
            setUploadSpeedBps(speed > 0 ? speed : null);
            setUploadEta(speed > 0 ? (e.total - e.loaded) / speed : null);
            lastSpeedLoaded = e.loaded; lastSpeedTime = now;
          }
        };
        const resUrl = await stageAndUpload(meta, file, 0, 1, singleDonePartsRef, onProg);
        setUploadProgress(100);
        const svr = await fetch("/api/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "save", files: [{ resourceUrl: resUrl, filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, displayName: displayName || file.name }], productId: selected.productId, productTitle: selected.productTitle, downloadEnabled: true }) });
        const svd = await svr.json();
        if (!svr.ok || svd.error) throw new Error(svd.error || "Save failed.");
      } else {
        // ── Large file: chunked parallel with JIT staging ──────────────────
        const numChunks = Math.ceil(file.size / CHUNK_SIZE);
        const parts = Array.from({ length: numChunks }, (_, ci) => ({ chunkIndex: ci, start: ci * CHUNK_SIZE, end: Math.min((ci + 1) * CHUNK_SIZE, file.size) }));
        console.log(`[Pendora] Chunked upload: "${file.name}" → ${parts.length} parts`);
        const ext = file.name.includes(".") ? file.name.substring(file.name.lastIndexOf(".")) : "";
        const base = file.name.includes(".") ? file.name.substring(0, file.name.lastIndexOf(".")) : file.name;
        const chunkBytesMap = {};

        const uploadTasks = parts.map((part, i) => () => {
          const meta = { filename: `${base}_chunk${part.chunkIndex}${ext}`, mimeType: "application/octet-stream", fileSize: part.end - part.start };
          const blob = file.slice(part.start, part.end);
          const onProg = (e) => {
            if (!e.lengthComputable) return;
            chunkBytesMap[i] = e.loaded;
            const loaded = Object.values(chunkBytesMap).reduce((a, b) => a + b, 0);
            setUploadProgress(Math.round((loaded / totalBytes) * 100));
            const now = Date.now(); const elapsed = (now - lastSpeedTime) / 1000;
            if (elapsed >= 0.8) {
              const speed = (loaded - lastSpeedLoaded) / elapsed;
              setUploadSpeedBps(speed > 0 ? speed : null);
              setUploadEta(speed > 0 ? (totalBytes - loaded) / speed : null);
              lastSpeedLoaded = loaded; lastSpeedTime = now;
            }
          };
          return stageAndUpload(meta, blob, i, parts.length, singleDonePartsRef, onProg);
        });
        await withConcurrency(uploadTasks, MAX_PARALLEL);
        const resourceUrls = parts.map((_, i) => singleDonePartsRef.current[i]);
        setUploadProgress(100);
        console.log(`[Pendora] All ${resourceUrls.length} parts uploaded`);
        const svr = await fetch("/api/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "save", files: [{ chunkUrls: resourceUrls, filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, displayName: displayName || file.name }], productId: selected.productId, productTitle: selected.productTitle, downloadEnabled: true }) });
        const svd = await svr.json();
        if (!svr.ok || svd.error) throw new Error(svd.error || "Save failed.");
      }
      singleDonePartsRef.current = {};
      if (fileInputRef.current) fileInputRef.current.value = "";
      setDisplayName(""); setUploadSuccess(`"${file.name}" uploaded successfully.`); revalidate();
    } catch (err) { console.error("[Pendora] Upload error:", err.message); setUploadError(err.message); }
    finally { setIsUploading(false); setUploadingProductId(null); setUploadProgress(0); setUploadSpeedBps(null); setUploadEta(null); }
  };

  const handleDeleteFile = (fileId) => {
    // If this is the last file, deleting it will also remove the product from the sidebar
    // (because digitalProducts is built from productFile rows — 0 files = no product entry).
    // Warn the user so they're not surprised.
    const currentFiles = selected?.files.filter((f) => !deletedFileIds.has(f.id)) ?? [];
    if (currentFiles.length === 1) {
      setConfirmDelete({ id: selected.productId, name: selected.productTitle, fileCount: 0, isLastFile: true, fileId });
      return;
    }
    setDeletedFileIds((prev) => { const n = new Set(prev); n.add(fileId); return n; });
    const fd = new FormData(); fd.append("_action", "deleteFile"); fd.append("fileId", fileId);
    deleteFetcher.submit(fd, { method: "POST" });
  };

  const handleDeleteProduct = (productId) => {
    setDeletedProductIds((prev) => { const n = new Set(prev); n.add(productId); return n; });
    if (selectedId === productId) { setSelectedId(null); setMode("view"); }
    const fd = new FormData(); fd.append("_action", "deleteProduct"); fd.append("productId", productId);
    productDeleteFetcher.submit(fd, { method: "POST" });
  };

  const wizardPickFiles = (e) => {
    const newFiles = Array.from(e.target.files || []);
    setWFiles((prev) => { const ex = new Set(prev.map((f) => f.name + f.size)); return [...prev, ...newFiles.filter((f) => !ex.has(f.name + f.size))]; });
    e.target.value = "";
  };

  // When user reaches the Review step, immediately fire /api/stage for all
  // selected files — so presigned URLs are ready before they click "Create Product".
  useEffect(() => {
    if (wStep !== 3 || !wFiles.length) return;
    wPrestageRef.current = null;
    const snapshot = wFiles.map((f) => ({ name: f.name, size: f.size }));
    const promise = fetch("/api/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "stage", files: wFiles.map((f) => ({ filename: f.name, mimeType: f.type || "application/octet-stream", fileSize: f.size })) }),
    })
      .then((r) => r.json())
      .then((sd) => sd.targets?.length === wFiles.length ? sd.targets : null)
      .catch(() => null);
    wPrestageRef.current = { files: snapshot, promise };
  }, [wStep]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleWizardSubmit = async () => {
    if (wSubmitting || !wProduct || (!wFiles.length && !wExisting.length)) return;
    setWSubmitting(true); setWError(null); setWCanRetry(false); setWProgressText("0%");
    setIsUploading(true); setUploadingProductId(wProduct.id);
    const cacheKey = wFiles.length ? resumeCacheKey(wProduct.id, wFiles) : null;
    try {
      let uploaded = [];

      // Skip entire upload section if only cloning existing files
      if (wFiles.length) {
      // ── 0. Load resume cache from localStorage ──────────────────────────
      if (!Object.keys(wDonePartsRef.current).length) {
        const cached = loadResumeCache(cacheKey);
        if (cached) {
          wDonePartsRef.current = cached;
          console.log(`[Pendora] Resume: loaded ${Object.keys(cached).length} done parts from cache`);
        }
      }

      // ── 1. Build chunk plan ─────────────────────────────────────────────
      const fileChunks = wFiles.map((file) => {
        if (file.size > CHUNK_THRESHOLD) {
          const n = Math.ceil(file.size / CHUNK_SIZE);
          return Array.from({ length: n }, (_, ci) => ({
            file, chunkIndex: ci, isChunk: true,
            start: ci * CHUNK_SIZE, end: Math.min((ci + 1) * CHUNK_SIZE, file.size),
          }));
        }
        return [{ file, chunkIndex: 0, isChunk: false, start: 0, end: file.size }];
      });
      const allParts = fileChunks.flat();
      wTotalBytesRef.current = allParts.reduce((sum, p) => sum + (p.end - p.start), 0);
      wChunkBytesRef.current = {};
      // Pre-fill done parts' bytes so progress starts from resume point
      for (const [idx, _] of Object.entries(wDonePartsRef.current)) {
        const p = allParts[idx]; if (p) wChunkBytesRef.current[idx] = p.end - p.start;
      }
      const doneCount = Object.keys(wDonePartsRef.current).length;
      console.log(`[Pendora] Wizard: ${allParts.length} parts, ${doneCount} already done (resume), chunked=${allParts.some(p => p.isChunk)}`);

      // ── 2. Helper: get stage metadata for a part ──────────────────────
      const getStageMeta = (part) => {
        const { file, isChunk, start, end } = part;
        const ext = file.name.includes(".") ? file.name.substring(file.name.lastIndexOf(".")) : "";
        const base = file.name.includes(".") ? file.name.substring(0, file.name.lastIndexOf(".")) : file.name;
        return {
          filename: isChunk ? `${base}_chunk${part.chunkIndex}${ext}` : file.name,
          mimeType: isChunk ? "application/octet-stream" : (file.type || "application/octet-stream"),
          fileSize: end - start,
        };
      };

      // ── 3. Upload in rounds: batch-stage → parallel upload → next round ─
      // Each round: stage MAX_PARALLEL parts in 1 API call, upload them in parallel.
      // 5GB = 200 parts → ~34 rounds, 34 stage calls (vs 200 before).
      const MAX_RETRIES = 3;
      for (let roundStart = 0; roundStart < allParts.length; roundStart += MAX_PARALLEL) {
        const roundIndices = [];
        for (let j = roundStart; j < Math.min(roundStart + MAX_PARALLEL, allParts.length); j++) roundIndices.push(j);

        // Filter out already-done parts (from resume)
        const pendingIndices = roundIndices.filter(i => !wDonePartsRef.current[i]);
        if (!pendingIndices.length) continue; // entire round already done

        // Batch stage — 1 API call for up to 6 parts
        const pendingMetas = pendingIndices.map(i => getStageMeta(allParts[i]));
        let targets;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const sr = await fetch("/api/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "stage", files: pendingMetas }) });
            const sd = await sr.json();
            if (!sr.ok || sd.error) throw new Error(sd.error || "Stage failed.");
            targets = sd.targets;
            break;
          } catch (err) {
            console.warn(`[Pendora] Stage round ${Math.floor(roundStart / MAX_PARALLEL) + 1} attempt ${attempt}: ${err.message}`);
            if (attempt === MAX_RETRIES) throw new Error(`Stage failed after ${MAX_RETRIES} retries at part ${roundStart}`);
            await new Promise(r => setTimeout(r, 1500 * attempt));
          }
        }

        // Parallel upload this round's pending parts
        await Promise.all(pendingIndices.map(async (partIndex, ti) => {
          const part = allParts[partIndex];
          const target = targets[ti];
          const mimeType = getStageMeta(part).mimeType;
          const blob = part.isChunk ? part.file.slice(part.start, part.end) : part.file;

          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              await new Promise((res, rej) => {
                const xhr = new XMLHttpRequest(); xhr.open("PUT", target.url);
                if (target.parameters?.length) { for (const p of target.parameters) { try { xhr.setRequestHeader(p.name, p.value); } catch {} } }
                if (!target.parameters?.some(p => p.name.toLowerCase() === "content-type")) { xhr.setRequestHeader("Content-Type", mimeType); }
                xhr.timeout = 0;
                xhr.upload.onprogress = (e) => {
                  if (!e.lengthComputable || !wTotalBytesRef.current) return;
                  wChunkBytesRef.current[partIndex] = e.loaded;
                  const loaded = Object.values(wChunkBytesRef.current).reduce((a, b) => a + b, 0);
                  setWProgressText(`${Math.min(Math.round((loaded / wTotalBytesRef.current) * 100), 99)}%`);
                };
                xhr.onerror = () => rej(new Error("Network error"));
                xhr.onabort = () => rej(new Error("Cancelled"));
                xhr.onload = () => xhr.status < 300 ? res() : rej(new Error(`HTTP ${xhr.status}`));
                xhr.send(blob);
              });
              // Success — cache in memory + localStorage
              wDonePartsRef.current[partIndex] = target.resourceUrl;
              wChunkBytesRef.current[partIndex] = part.end - part.start;
              saveResumeCache(cacheKey, wFiles, wDonePartsRef.current);
              console.log(`[Pendora] Part ${partIndex + 1}/${allParts.length} OK`);
              return;
            } catch (err) {
              console.warn(`[Pendora] Part ${partIndex + 1} upload attempt ${attempt}: ${err.message}`);
              if (attempt === MAX_RETRIES) throw new Error(`Failed after ${MAX_RETRIES} retries: "${part.file.name}" part ${partIndex}`);
              await new Promise(r => setTimeout(r, 1000 * attempt));
            }
          }
        }));
        console.log(`[Pendora] Round ${Math.floor(roundStart / MAX_PARALLEL) + 1} done (parts ${roundStart + 1}-${Math.min(roundStart + MAX_PARALLEL, allParts.length)})`);
      }
      const resourceUrls = allParts.map((_, i) => wDonePartsRef.current[i]);
      setWProgressText("100%");
      console.log(`[Pendora] Wizard: all ${resourceUrls.length} parts uploaded`);

      // ── 4. Build save payload ───────────────────────────────────────────
      let partIdx = 0;
      uploaded = wFiles.map((file, fi) => {
        const chunks = fileChunks[fi];
        if (chunks[0].isChunk) {
          const chunkUrls = chunks.map(() => resourceUrls[partIdx++]);
          return { chunkUrls, filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, displayName: file.name };
        }
        return { resourceUrl: resourceUrls[partIdx++], filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, displayName: file.name };
      });
      } // end if (wFiles.length)

      // ── 5. Save new uploads ──────────────────────────────────────────────
      if (uploaded.length) {
        const svr = await fetch("/api/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "save", files: uploaded, productId: wProduct.id, productTitle: wProduct.title, downloadEnabled: true }) });
        const svd = await svr.json();
        if (!svr.ok || svd.error) throw new Error(svd.error || "Save failed.");
        console.log("[Pendora] Wizard: new files saved");
      }

      // ── 6. Clone existing files (instant, no upload) ────────────────────
      if (wExisting.length) {
        const cr = await fetch("/api/clone-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds: wExisting.map((e) => e.id), productId: wProduct.id, productTitle: wProduct.title }) });
        const cd = await cr.json();
        if (!cr.ok || cd.error) throw new Error(cd.error || "Clone failed.");
        console.log(`[Pendora] Wizard: ${wExisting.length} existing files cloned`);
      }

      wDonePartsRef.current = {};
      try { localStorage.removeItem(cacheKey); } catch {}
      pendingRevalidate.current = true;
      setMode("view");
    } catch (err) {
      console.error("[Pendora] Wizard error:", err.message);
      const doneCount = Object.keys(wDonePartsRef.current).length;
      setWError(`${err.message} (${doneCount} parts uploaded successfully)`);
      setWCanRetry(doneCount > 0); // show Retry button if some parts succeeded
    }
    finally { setWSubmitting(false); setIsUploading(false); setUploadingProductId(null); setWProgressText(""); }
  };

  // Build shopifyProducts from the lazy-fetched /api/products data.
  // alreadyCreated is derived from digitalProducts so it's always fresh after revalidations.
  const existingIds = new Set(digitalProducts.map((p) => p.productId));
  const shopifyProductsRaw = shopifyFetcher.data?.products ?? [];
  const shopifyLoading = mode === "create" && shopifyFetcher.state !== "idle";

  // Override alreadyCreated for products the user just deleted — don't wait for loader revalidation
  const filteredShopify = shopifyProductsRaw
    .map((p) => ({ ...p, alreadyCreated: existingIds.has(p.id) }))
    .filter((p) => p.title.toLowerCase().includes(wSearch.toLowerCase()))
    .map((p) => deletedProductIds.has(p.id) ? { ...p, alreadyCreated: false } : p);

  // ── Style helpers ──────────────────────────────────────────────────────────
  const formatEta = (secs) => {
    if (!secs || secs < 1) return null;
    if (secs < 60) return `${Math.round(secs)}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  };

  // Flat list of all existing files for "use existing" in wizard
  const allExistingFiles = digitalProducts.flatMap((p) => p.files.map((f) => ({ ...f, productTitle: p.productTitle, productId: p.productId })));

  const inp = { padding: "8px 12px", border: `1px solid ${t.inputBdr}`, borderRadius: "8px", background: t.inputBg, color: t.text, fontSize: "14px", outline: "none", width: "100%", boxSizing: "border-box", transition: TR };
  const B = {
    primary:   { border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 700, fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", padding: "9px 20px", background: t.active, color: t.accentText, transition: TR },
    secondary: { border: `1px solid ${t.border}`, borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: t.surface, color: t.text, transition: TR },
    danger:    { border: `1px solid ${t.dangerBdr}`, borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 12px", background: t.dangerBg, color: t.danger, transition: TR },
    ghost:     { border: `1px solid ${t.border}`, borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "transparent", color: t.muted, transition: TR },
  };

  // ── Header bar ─────────────────────────────────────────────────────────────
  const renderHeader = () => (
    <div style={{ background: t.headerBg, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, transition: TR }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: 34, height: 34, borderRadius: "9px", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
          {Ic.spark(18)}
        </div>
        <div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: "17px", letterSpacing: "-0.2px", lineHeight: 1.1 }}>Pendora</div>
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: "10px", fontWeight: 500, letterSpacing: "0.6px" }}>DIGITAL PRODUCTS</div>
        </div>
      </div>
      {mode !== "create" && (
        <button
          onClick={isUploading ? undefined : openCreate}
          style={{ padding: "7px 16px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.15)", color: "#fff", cursor: isUploading ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px", opacity: isUploading ? 0.5 : 1, transition: "all 0.15s" }}>
          {Ic.plus(14)} Add Product
        </button>
      )}
    </div>
  );

  // ── Outer shell ───────────���─────────��──────────────────────────────────────
  const wrap = (inner) => (
    <div style={{ position: "fixed", inset: 0, background: t.bg, color: t.text, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", transition: TR }}>
      {renderHeader()}
      {inner}
    </div>
  );

  // ── Main layout (always 2-panel) ─────���────────────────────────────────────
  return wrap(
    <>
    <style>{`
      @keyframes pendora-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
      .pendora-noscroll::-webkit-scrollbar { display: none; }
    `}</style>
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

      {/* Main panel — full width, no sidebar */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: mode === "create" ? "hidden" : "auto", background: t.bg, transition: TRD, minHeight: 0 }}>

        {mode === "create" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
            <Wizard B={B} inp={inp} Ic={Ic} t={t}
              step={wStep} setStep={setWStep} search={wSearch} setSearch={setWSearch}
              wProduct={wProduct} setWProduct={setWProduct} wFiles={wFiles} setWFiles={setWFiles}
              wExisting={wExisting} setWExisting={setWExisting} allExistingFiles={allExistingFiles}
              wSubmitting={wSubmitting} wError={wError} wCanRetry={wCanRetry} wDonePartsRef={wDonePartsRef} wProgressText={wProgressText}
              filteredShopify={filteredShopify} shopifyLoading={shopifyLoading}
              wizardFileInputRef={wizardFileInputRef} wizardPickFiles={wizardPickFiles}
              handleWizardSubmit={handleWizardSubmit} onCancel={() => setMode("view")} />
          </div>
        )}

        {/* Skeleton: card list variant (view mode) */}
        {mode === "view" && showSkeleton(isRevalidating, selected) && (
          <div style={{ padding: "24px 28px" }}>
            <div style={{ marginBottom: "18px" }}>
              <div style={{ height: 17, background: t.border, borderRadius: 4, width: 160, marginBottom: 10, animation: "pendora-pulse 1.4s ease-in-out infinite" }} />
              <div style={{ height: 12, background: t.border, borderRadius: 4, width: 80, animation: "pendora-pulse 1.4s ease-in-out 0.1s infinite" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {[1, 2, 3].map((i) => (
                <div key={i} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", overflow: "hidden", boxShadow: t.shadow }}>
                  <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${t.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: 38, height: 38, borderRadius: "10px", background: t.border, flexShrink: 0, animation: `pendora-pulse 1.4s ease-in-out ${i * 0.1}s infinite` }} />
                      <div>
                        <div style={{ height: 13, background: t.border, borderRadius: 4, width: 140 + i * 20, marginBottom: 6, animation: `pendora-pulse 1.4s ease-in-out ${i * 0.1}s infinite` }} />
                        <div style={{ height: 10, background: t.border, borderRadius: 4, width: 60, animation: `pendora-pulse 1.4s ease-in-out ${i * 0.15}s infinite` }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ height: 34, width: 56, background: t.border, borderRadius: 8, animation: `pendora-pulse 1.4s ease-in-out ${i * 0.1}s infinite` }} />
                      <div style={{ height: 34, width: 38, background: t.border, borderRadius: 8, animation: `pendora-pulse 1.4s ease-in-out ${i * 0.15}s infinite` }} />
                    </div>
                  </div>
                  <div style={{ padding: "10px 18px 10px 68px", background: "#FAFAFA" }}>
                    <div style={{ height: 12, background: t.border, borderRadius: 4, width: `${45 + i * 10}%`, animation: `pendora-pulse 1.4s ease-in-out ${i * 0.12}s infinite` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skeleton: detail variant (detail mode) */}
        {mode === "detail" && showSkeleton(isRevalidating, selected) && (
          <div style={{ padding: "22px 28px" }}>
            <div style={{ marginBottom: "20px", paddingBottom: "16px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: 42, height: 42, borderRadius: "11px", background: t.border, flexShrink: 0, animation: "pendora-pulse 1.4s ease-in-out infinite" }} />
                <div>
                  <div style={{ height: 18, background: t.border, borderRadius: 4, width: 200, marginBottom: 8, animation: "pendora-pulse 1.4s ease-in-out infinite" }} />
                  <div style={{ height: 11, background: t.border, borderRadius: 4, width: 100, animation: "pendora-pulse 1.4s ease-in-out 0.2s infinite" }} />
                </div>
              </div>
              <div style={{ height: 34, width: 120, background: t.border, borderRadius: 8, animation: "pendora-pulse 1.4s ease-in-out infinite" }} />
            </div>
            <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", padding: "18px 20px", marginBottom: "16px" }}>
              <div style={{ height: 11, background: t.border, borderRadius: 4, width: "28%", marginBottom: 16, animation: "pendora-pulse 1.4s ease-in-out infinite" }} />
              <div style={{ height: 34, background: t.border, borderRadius: 8, width: "55%", marginBottom: 12, animation: "pendora-pulse 1.4s ease-in-out 0.1s infinite" }} />
              <div style={{ height: 34, background: t.border, borderRadius: 8, width: "38%", animation: "pendora-pulse 1.4s ease-in-out 0.2s infinite" }} />
            </div>
            <div style={{ background: t.surface, borderRadius: "12px", border: `1px solid ${t.border}`, overflow: "hidden" }}>
              <div style={{ padding: "12px 18px", borderBottom: `1px solid ${t.border}` }}>
                <div style={{ height: 11, background: t.border, borderRadius: 4, width: "22%", animation: "pendora-pulse 1.4s ease-in-out infinite" }} />
              </div>
              {[1, 2].map((i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 18px", borderBottom: `1px solid ${t.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "9px", background: t.border, animation: "pendora-pulse 1.4s ease-in-out infinite" }} />
                    <div>
                      <div style={{ height: 13, background: t.border, borderRadius: 4, width: 160, marginBottom: 7, animation: "pendora-pulse 1.4s ease-in-out infinite" }} />
                      <div style={{ height: 10, background: t.border, borderRadius: 4, width: 100, animation: `pendora-pulse 1.4s ease-in-out ${i * 0.15}s infinite` }} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ height: 32, width: 80, background: t.border, borderRadius: 8, animation: "pendora-pulse 1.4s ease-in-out infinite" }} />
                    <div style={{ height: 32, width: 70, background: t.border, borderRadius: 8, animation: "pendora-pulse 1.4s ease-in-out 0.1s infinite" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Product Card List (view mode) ── */}
        {mode === "view" && !visibleProducts.length && !showSkeleton(isRevalidating, selected) && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "16px", textAlign: "center", padding: "40px 48px" }}>
            <div style={{ width: 64, height: 64, borderRadius: "16px", background: t.surface, border: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: t.faint, boxShadow: t.shadow }}>{Ic.box(30)}</div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: t.text }}>No digital products yet</div>
            <div style={{ fontSize: "14px", color: t.muted, maxWidth: "360px", lineHeight: 1.7 }}>
              Add your first product to start selling digital files to your customers.
            </div>
            <button onClick={openCreate} style={{ ...B.primary, padding: "11px 28px", fontSize: "14px", borderRadius: "10px", marginTop: "4px" }}>{Ic.plus(15)} Add Product</button>
          </div>
        )}

        {mode === "view" && visibleProducts.length > 0 && !showSkeleton(isRevalidating, selected) && (
          <div style={{ padding: "24px 28px" }}>
            <div style={{ marginBottom: "18px" }}>
              <div style={{ fontWeight: 700, fontSize: "17px", color: t.text }}>Digital Products</div>
              <div style={{ fontSize: "13px", color: t.muted, marginTop: "3px" }}>{visibleProducts.length} {visibleProducts.length === 1 ? "product" : "products"}</div>
            </div>
            {productDeleteError && <div style={{ padding: "10px 14px", background: t.dangerBg, border: `1px solid ${t.dangerBdr}`, borderRadius: "10px", color: t.danger, fontSize: "13px", marginBottom: "14px" }}>{productDeleteError}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {visibleProducts.map((product) => (
                <div key={product.productId} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", boxShadow: t.shadow, overflow: "hidden" }}>
                  {/* Card header */}
                  <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: product.files.length ? `1px solid ${t.border}` : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: 38, height: 38, borderRadius: "10px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: t.accent, flexShrink: 0 }}>{Ic.box(19)}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: t.text }}>{product.productTitle}</div>
                        <div style={{ fontSize: "12px", color: t.muted, marginTop: "1px" }}>{product.files.length} {product.files.length === 1 ? "file" : "files"}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => { setSelectedId(product.productId); setMode("detail"); setUploadError(null); setUploadSuccess(null); }} style={B.secondary}>
                        Edit
                      </button>
                      <button onClick={() => setConfirmDelete({ id: product.productId, name: product.productTitle, fileCount: product.files.length })} style={B.danger}>
                        {Ic.trash(13)}
                      </button>
                    </div>
                  </div>
                  {/* File rows */}
                  {product.files.length > 0 && product.files.map((file, idx) => (
                    <div key={file.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 18px 10px 68px", borderBottom: idx < product.files.length - 1 ? `1px solid ${t.border}` : "none", background: "#FAFAFA" }}>
                      <div style={{ color: t.faint, flexShrink: 0 }}>{Ic.file(14)}</div>
                      <span style={{ fontSize: "13px", fontWeight: 500, color: t.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.fileName}</span>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: t.accent, background: `rgba(245,165,36,0.1)`, padding: "2px 8px", borderRadius: "6px", letterSpacing: "0.3px", flexShrink: 0 }}>{getFileType(file.fileName)}</span>
                      <span style={{ fontSize: "12px", color: t.muted, flexShrink: 0, minWidth: "55px", textAlign: "right" }}>{file.fileSize}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Product Detail (edit mode) ── */}
        {mode === "detail" && selected && !showSkeleton(isRevalidating, selected) && (() => {
          const visibleFiles = selected.files;
          return (
            <div style={{ padding: "22px 28px" }}>
              {/* Back + Title */}
              <div style={{ marginBottom: "20px", paddingBottom: "16px", borderBottom: `1px solid ${t.border}`, transition: TRD }}>
                <button onClick={() => setMode("view")} style={{ background: "none", border: "none", color: t.muted, cursor: "pointer", fontSize: "13px", fontWeight: 600, padding: "0 0 10px", display: "flex", alignItems: "center", gap: "4px" }}>
                  ← Back to products
                </button>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ width: 42, height: 42, borderRadius: "11px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: t.accent, flexShrink: 0 }}>
                      {Ic.box(21)}
                    </div>
                    <div>
                      <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: t.text }}>{selected.productTitle}</h2>
                      <div style={{ fontSize: "12px", color: t.muted, marginTop: "2px" }}>{visibleFiles.length} {visibleFiles.length === 1 ? "file" : "files"} attached</div>
                    </div>
                  </div>
                  <button onClick={() => setConfirmDelete({ id: selected.productId, name: selected.productTitle, fileCount: selected.files.length })} disabled={isBusy} style={{ ...B.danger, opacity: isBusy ? 0.5 : 1, flexShrink: 0 }}>
                    {Ic.trash(13)} Delete Product
                  </button>
                </div>
              </div>

              {/* Upload */}
              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", padding: "18px 20px", marginBottom: "16px", boxShadow: t.shadow, transition: TRD }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "14px" }}>
                  <div style={{ color: t.accent }}>{Ic.upload(15)}</div>
                  <span style={{ fontWeight: 800, fontSize: "11px", color: t.muted, textTransform: "uppercase", letterSpacing: "0.7px" }}>Upload File</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
                  <div>
                    <label style={{ display: "block", marginBottom: "4px", fontWeight: 600, fontSize: "12px", color: t.muted }}>Select File</label>
                    <input ref={fileInputRef} type="file" disabled={isBusy} accept=".pdf,.zip,.mp3,.mp4,.png,.jpg,.jpeg,.gif,.webp,.mov,.epub,.docx,.xlsx" onChange={handleFileSelect} style={{ color: t.text, fontSize: "13px", opacity: isBusy ? 0.5 : 1 }} />
                    <div style={{ fontSize: "11px", color: t.faint, marginTop: "3px" }}>Max 5 GB — PDF, ZIP, MP3, MP4, PNG, JPG, GIF, EPUB, DOCX, XLSX</div>
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: "4px", fontWeight: 600, fontSize: "12px", color: t.muted }}>Display Name</label>
                    <input type="text" value={displayName} disabled={isBusy} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. User Guide PDF" style={{ ...inp, width: "260px", opacity: isBusy ? 0.5 : 1 }} />
                  </div>
                  <button disabled={isBusy || isUploading} onClick={handleUpload} style={{ ...B.primary, opacity: (isBusy || isUploading) ? 0.6 : 1, alignSelf: "flex-start" }}>
                    {Ic.upload(14)} {isBusy ? "Uploading…" : "Upload File"}
                  </button>
                  {isBusy && (
                    <div style={{ marginTop: "2px" }}>
                      <div style={{ height: 6, background: t.border, borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${uploadProgress}%`, background: t.accent, borderRadius: 999, transition: "width 0.4s ease" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px", fontSize: "11px", color: t.muted }}>
                        <span>{uploadProgress}%{uploadSpeedBps ? ` · ${formatFileSize(uploadSpeedBps)}/s` : ""}</span>
                        {formatEta(uploadEta) && <span>~{formatEta(uploadEta)} left</span>}
                      </div>
                    </div>
                  )}
                  {uploadError && <div style={{ padding: "9px 13px", background: "#fef9e7", border: "1px solid #e6c84e", borderRadius: "8px", color: "#8a6d0b", fontSize: "13px" }}>{uploadError}</div>}
                  {uploadSuccess && <div style={{ padding: "9px 13px", background: t.successBg, border: `1px solid ${t.successBdr}`, borderRadius: "8px", color: t.success, fontSize: "13px" }}>✓ {uploadSuccess}</div>}
                </div>
              </div>

              {/* Files */}
              <div style={{ background: t.surface, borderRadius: "12px", border: `1px solid ${t.border}`, overflow: "hidden", boxShadow: t.shadow, transition: TRD }}>
                <div style={{ padding: "12px 18px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: "7px", transition: TRD }}>
                  <div style={{ color: t.accent }}>{Ic.file(14)}</div>
                  <span style={{ fontWeight: 800, fontSize: "11px", color: t.muted, textTransform: "uppercase", letterSpacing: "0.7px" }}>Attached Files ({visibleFiles.length})</span>
                </div>
                {fileDeleteError && <div style={{ padding: "9px 18px", background: t.dangerBg, color: t.danger, fontSize: "13px", borderBottom: `1px solid ${t.dangerBdr}` }}>{fileDeleteError}</div>}
                {!visibleFiles.length
                  ? <div style={{ padding: "26px", textAlign: "center", color: t.faint, fontSize: "14px" }}>No files yet. Upload one above.</div>
                  : visibleFiles.map((file, idx) => (
                    <div key={file.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: idx < visibleFiles.length - 1 ? `1px solid ${t.border}` : "none", transition: TRD }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
                        <div style={{ width: 36, height: 36, borderRadius: "9px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: t.accent, flexShrink: 0, transition: TRD }}>{Ic.file(18)}</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "14px", color: t.text }}>{file.displayName}</div>
                          {file.displayName !== file.fileName && <div style={{ fontSize: "11px", color: t.faint }}>{file.fileName}</div>}
                          <div style={{ fontSize: "11px", color: t.muted, marginTop: "1px" }}>
                            <span style={{ fontSize: "10px", fontWeight: 700, color: t.accent, background: `rgba(245,165,36,0.1)`, padding: "1px 6px", borderRadius: "4px", marginRight: "6px" }}>{getFileType(file.fileName)}</span>
                            {file.fileSize} · {new Date(file.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <a href={`/api/files/${file.id}?token=${file.downloadToken}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                          <button style={B.secondary}>{Ic.download(14)} Preview</button>
                        </a>
                        <button onClick={() => handleDeleteFile(file.id)} disabled={isBusy} style={{ ...B.danger, opacity: isBusy ? 0.5 : 1, cursor: isBusy ? "not-allowed" : "pointer" }}>
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
    {/* Confirmation modal */}
    {confirmDelete && (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
        <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: "16px", padding: "28px 32px", maxWidth: "400px", width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.35)" }}>
          <div style={{ width: 48, height: 48, borderRadius: "12px", background: t.dangerBg, border: `1px solid ${t.dangerBdr}`, display: "flex", alignItems: "center", justifyContent: "center", color: t.danger, marginBottom: "16px" }}>
            {Ic.trash(22)}
          </div>
          <div style={{ fontSize: "18px", fontWeight: 800, color: t.text, marginBottom: "8px" }}>
            {confirmDelete.isLastFile ? "Delete Last File?" : "Delete Product?"}
          </div>
          <div style={{ fontSize: "14px", color: t.muted, lineHeight: 1.65, marginBottom: "24px" }}>
            {confirmDelete.isLastFile
              ? <>This is the <strong style={{ color: t.text }}>last file</strong> for <strong style={{ color: t.text }}>{confirmDelete.name}</strong>. Deleting it will also remove this product from Pendora. This cannot be undone.</>
              : <>This will permanently remove <strong style={{ color: t.text }}>{confirmDelete.name}</strong> and all {confirmDelete.fileCount} attached {confirmDelete.fileCount === 1 ? "file" : "files"} from Pendora. This cannot be undone.</>
            }
          </div>
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <button onClick={() => setConfirmDelete(null)} style={{ ...B.secondary, padding: "10px 20px" }}>Cancel</button>
            <button onClick={() => { handleDeleteProduct(confirmDelete.id); setConfirmDelete(null); }} style={{ ...B.danger, padding: "10px 20px", fontWeight: 700 }}>
              {Ic.trash(13)} Delete
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

function Wizard({ inp, Ic, t, step, setStep, search, setSearch, wProduct, setWProduct, wFiles, setWFiles, wExisting, setWExisting, allExistingFiles, wSubmitting, wError, wCanRetry, wDonePartsRef, wProgressText, filteredShopify, shopifyLoading, wizardFileInputRef, wizardPickFiles, handleWizardSubmit, onCancel }) {
  const btnSecondary = { padding: "11px 24px", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px", background: t.surface, border: `1.5px solid ${t.border}`, color: t.text, transition: "opacity 0.15s" };
  const btnPrimary   = { padding: "11px 28px", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "8px", border: "none", background: t.active, color: "#fff", transition: "opacity 0.15s" };

  // ── Sticky bottom bar ──────────────────────────────────────────────────────
  const renderFooter = () => {
    if (step === 1) return (
      <>
        <button onClick={onCancel} style={btnSecondary}>Cancel</button>
        <button disabled={!wProduct} onClick={() => wProduct && setStep(2)} style={{ ...btnPrimary, opacity: wProduct ? 1 : 0.5 }}>Upload Files →</button>
      </>
    );
    if (step === 2) return (
      <>
        <button onClick={() => setStep(1)} style={btnSecondary}>← Back</button>
        <button disabled={!wFiles.length && !wExisting.length} onClick={() => (wFiles.length || wExisting.length) && setStep(3)} style={{ ...btnPrimary, opacity: (wFiles.length || wExisting.length) ? 1 : 0.5 }}>Review →</button>
      </>
    );
    return (
      <>
        <button disabled={wSubmitting} onClick={() => setStep(2)} style={{ ...btnSecondary, opacity: wSubmitting ? 0.5 : 1 }}>← Back</button>
        <button disabled={wSubmitting} onClick={handleWizardSubmit} style={{ ...btnPrimary, padding: "11px 32px", opacity: wSubmitting ? 0.7 : 1 }}>
          {wSubmitting ? "Uploading…" : wCanRetry ? `⟳ Retry Upload (${Object.keys(wDonePartsRef.current).length} parts done)` : "✓ Create Product"}
        </button>
      </>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── Step indicator (fixed top) ── */}
      <div style={{ flexShrink: 0, padding: "28px 40px 20px", borderBottom: `1px solid ${t.border}` }}>
        <div style={{ display: "flex", alignItems: "center", padding: "0 4px" }}>
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
      </div>

      {/* ── Scrollable content (middle) ── */}
      <div className="pendora-noscroll" style={{ flex: 1, overflowY: "auto", padding: "28px 40px", minHeight: 0, scrollbarWidth: "none" }}>

        {/* Step 1: Select product */}
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
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {shopifyLoading
                ? [1,2,3,4,5].map((i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 16px", borderRadius: "12px", border: `1px solid ${t.border}`, background: t.surface, animation: "pendora-pulse 1.4s ease-in-out infinite" }}>
                      <div style={{ width: 40, height: 40, borderRadius: "9px", background: t.border, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ height: 12, width: `${50 + i * 8}%`, background: t.border, borderRadius: 6, marginBottom: 6 }} />
                        <div style={{ height: 10, width: "30%", background: t.border, borderRadius: 6 }} />
                      </div>
                    </div>
                  ))
                : !filteredShopify.length
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
          </div>
        )}

        {/* Step 2: Upload files */}
        {step === 2 && (
          <div>
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontWeight: 800, fontSize: "20px", color: t.text, marginBottom: "4px" }}>Add files</div>
              <div style={{ fontSize: "13px", color: t.muted }}>For <strong style={{ color: t.text }}>{wProduct?.title}</strong></div>
            </div>

            {/* Upload new */}
            <input ref={wizardFileInputRef} type="file" multiple style={{ display: "none" }} onChange={wizardPickFiles} />
            <button onClick={() => wizardFileInputRef.current?.click()} style={{ ...btnSecondary, marginBottom: "8px" }}>
              {Ic.upload(15)} Upload New Files
            </button>
            <div style={{ fontSize: "12px", color: t.faint, marginBottom: "12px" }}>Max 5 GB — PDF, ZIP, MP3, MP4, PNG, JPG, GIF, EPUB, DOCX, XLSX</div>

            {/* New files list */}
            {wFiles.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "16px" }}>
                {wFiles.map((file, i) => (
                  <div key={`new-${i}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", border: `1px solid ${t.border}`, borderRadius: "11px", background: t.surface }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: 38, height: 38, borderRadius: "9px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: t.accent, flexShrink: 0 }}>{Ic.upload(16)}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: t.text }}>{file.name}</div>
                        <div style={{ fontSize: "12px", color: t.muted, marginTop: "2px" }}>{formatFileSize(file.size)} · New upload</div>
                      </div>
                    </div>
                    <button onClick={() => setWFiles((p) => p.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: t.muted, cursor: "pointer", fontSize: "22px", lineHeight: 1, padding: "0 6px" }}>×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Existing files list (selected) */}
            {wExisting.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "16px" }}>
                {wExisting.map((ef) => (
                  <div key={`ex-${ef.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", border: `1px solid ${t.accent}`, borderRadius: "11px", background: `rgba(245,165,36,0.04)` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: 38, height: 38, borderRadius: "9px", background: `rgba(245,165,36,0.12)`, display: "flex", alignItems: "center", justifyContent: "center", color: t.accent, flexShrink: 0 }}>{Ic.file(16)}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: t.text }}>{ef.displayName || ef.fileName}</div>
                        <div style={{ fontSize: "12px", color: t.accent, marginTop: "2px", fontWeight: 600 }}>{ef.fileSize} · From {ef.productTitle} · Instant</div>
                      </div>
                    </div>
                    <button onClick={() => setWExisting((p) => p.filter((x) => x.id !== ef.id))} style={{ background: "none", border: "none", color: t.muted, cursor: "pointer", fontSize: "22px", lineHeight: 1, padding: "0 6px" }}>×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {!wFiles.length && !wExisting.length && (
              <div style={{ padding: "36px 24px", border: `2px dashed ${t.border}`, borderRadius: "14px", textAlign: "center", color: t.muted, fontSize: "14px", background: t.surface, display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                <div style={{ color: t.accent, opacity: 0.7 }}>{Ic.upload(32)}</div>
                Upload new files or select from existing files below.
              </div>
            )}

            {/* Use existing files picker */}
            {allExistingFiles.length > 0 && (
              <div style={{ marginTop: "20px" }}>
                <div style={{ fontWeight: 700, fontSize: "14px", color: t.text, marginBottom: "10px" }}>Or use existing files</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  {allExistingFiles.filter((ef) => !wExisting.find((s) => s.id === ef.id)).map((ef) => (
                    <div key={ef.id} onClick={() => setWExisting((p) => [...p, ef])}
                      style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", border: `1px solid ${t.border}`, borderRadius: "10px", background: t.surface, cursor: "pointer", transition: "border-color 0.12s" }}>
                      <div style={{ width: 34, height: 34, borderRadius: "8px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: t.accent, flexShrink: 0 }}>{Ic.file(15)}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: "13px", color: t.text }}>{ef.displayName || ef.fileName}</div>
                        <div style={{ fontSize: "11px", color: t.muted }}>{ef.fileSize} · {ef.productTitle}</div>
                      </div>
                      <span style={{ fontSize: "11px", color: t.accent, fontWeight: 600 }}>+ Add</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div>
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontWeight: 800, fontSize: "20px", color: t.text, marginBottom: "4px" }}>Review & Save</div>
              <div style={{ fontSize: "13px", color: t.muted }}>Confirm the details below and save your digital product.</div>
            </div>
            {wSubmitting && (
              <div style={{ padding: "13px 18px", background: t.pill, border: `1px solid ${t.active}`, borderRadius: "11px", color: t.active, fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                <span>⏳ Uploading & saving…</span>
                {wProgressText && <span style={{ fontWeight: 800, fontSize: "15px" }}>{wProgressText}</span>}
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
                  <div style={{ fontSize: "12px", color: t.muted, marginBottom: "4px" }}>Files ({wFiles.length + wExisting.length})</div>
                  {wFiles.map((f, i) => (
                    <div key={`n-${i}`} style={{ fontSize: "14px", fontWeight: 600, color: t.text, marginBottom: "3px" }}>{f.name} <span style={{ fontWeight: 400, color: t.muted, fontSize: "12px" }}>({formatFileSize(f.size)}) · New upload</span></div>
                  ))}
                  {wExisting.map((ef) => (
                    <div key={`e-${ef.id}`} style={{ fontSize: "14px", fontWeight: 600, color: t.text, marginBottom: "3px" }}>{ef.displayName || ef.fileName} <span style={{ fontWeight: 400, color: t.accent, fontSize: "12px" }}>({ef.fileSize}) · Existing · Instant</span></div>
                  ))}
                </div>
              </div>
            </div>
            {wError && <div style={{ padding: "12px 16px", background: wCanRetry ? "#fef9e7" : t.dangerBg, border: `1px solid ${wCanRetry ? "#e6c84e" : t.dangerBdr}`, borderRadius: "10px", color: wCanRetry ? "#8a6d0b" : t.danger, fontSize: "14px" }}>{wError}</div>}
          </div>
        )}

      </div>

      {/* ── Sticky bottom buttons ── */}
      <div style={{ flexShrink: 0, padding: "14px 40px 20px", borderTop: `1px solid ${t.border}`, background: t.bg, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {renderFooter()}
      </div>

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
