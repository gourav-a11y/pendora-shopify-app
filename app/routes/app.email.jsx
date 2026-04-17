import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const C = {
  bg: "#F6F6F7", surface: "#FFFFFF", border: "#E1E3E5", text: "#303030",
  muted: "#6D7175", faint: "#999EA3", accent: "#F5A524", navy: "#1B2B44",
  danger: "#D72C0D", dangerBg: "#FFF4F4", dangerBdr: "#FDBDBD",
  success: "#008060", successBg: "#F1F8F5", successBdr: "#AEE9D1",
  shadow: "0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)",
};

const LOGS_PER_PAGE = 10;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  // Build where clause for search. SQLite `contains` is case-insensitive for ASCII (LIKE default).
  let where = { shop };
  if (q) {
    // Find matching fileIds by file name / display name first.
    const matchingFiles = await prisma.productFile.findMany({
      where: {
        shop,
        OR: [
          { fileName: { contains: q } },
          { displayName: { contains: q } },
        ],
      },
      select: { id: true },
      take: 200,
    });
    const matchingFileIds = matchingFiles.map((f) => f.id);

    const orClauses = [
      { customerName: { contains: q } },
      { customerEmail: { contains: q } },
      { productTitle: { contains: q } },
    ];
    // fileIds is stored as JSON string like `["abc","def"]` — substring match on the id works.
    for (const fid of matchingFileIds) {
      orClauses.push({ fileIds: { contains: fid } });
    }
    where = { shop, OR: orClauses };
  }

  const [template, total, allFiles] = await Promise.all([
    prisma.emailTemplate.findUnique({ where: { shop } }),
    prisma.emailLog.count({ where }),
    prisma.productFile.findMany({ where: { shop }, select: { id: true, fileName: true, displayName: true } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / LOGS_PER_PAGE));
  const safePage = Math.min(page, totalPages);

  const logs = await prisma.emailLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (safePage - 1) * LOGS_PER_PAGE,
    take: LOGS_PER_PAGE,
  });

  const fileMap = {};
  for (const f of allFiles) fileMap[f.id] = f.displayName || f.fileName;

  return {
    template: template || {
      subject: "Your digital files from {{shop_name}}",
      heading: "Hi {{customer_name}},",
      body: "Thank you for your order #{{order_number}}! Your digital files are ready to download.",
      footer: "Thanks for shopping with us!",
      buttonColor: "#1B2B44",
    },
    logs: logs.map((l) => ({ id: l.id, orderNumber: l.orderNumber, customerName: l.customerName, customerEmail: l.customerEmail, productTitle: l.productTitle, fileIds: l.fileIds, status: l.status, error: l.error, createdAt: l.createdAt.toISOString() })),
    fileMap,
    pagination: { page: safePage, totalPages, total, perPage: LOGS_PER_PAGE, q },
  };
};

export default function EmailPage() {
  const loaderData = useLoaderData();
  const { template: initTpl } = loaderData;
  const tplFetcher = useFetcher();
  const resendFetcher = useFetcher();
  // Reuses the same loader with ?page= and ?q= to fetch fresh pages/search results.
  const logFetcher = useFetcher();

  // Use fetcher data when it has loaded, otherwise fall back to loader data.
  const logData = logFetcher.data || loaderData;
  const initLogs = logData.logs;
  const fileMap = logData.fileMap;
  const pagination = logData.pagination;

  const [tab, setTab] = useState("template");
  const [resendPopup, setResendPopup] = useState(null); // { log, selectedFileIds: [...], customMessage: "" }
  const [subject, setSubject] = useState(initTpl.subject);
  const [heading, setHeading] = useState(initTpl.heading);
  const [body, setBody] = useState(initTpl.body);
  const [footer, setFooter] = useState(initTpl.footer);
  const [buttonColor, setButtonColor] = useState(initTpl.buttonColor);
  const [tplMsg, setTplMsg] = useState(null);

  // Log search + page state. Debounce search 300ms so we don't hit the server on every keystroke.
  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [logPage, setLogPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // When search changes, reset to page 1.
  useEffect(() => { setLogPage(1); }, [searchDebounced]);

  // Fetch new page / search from server. Skipped on initial render (loader already served page 1, q="").
  const didInit = useRef(false);
  useEffect(() => {
    if (!didInit.current) { didInit.current = true; return; }
    const params = new URLSearchParams();
    params.set("page", String(logPage));
    if (searchDebounced) params.set("q", searchDebounced);
    logFetcher.load(`/app/email?${params.toString()}`);
  }, [logPage, searchDebounced]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a successful resend, refresh the current log page so the new "resent" row appears.
  useEffect(() => {
    if (resendFetcher.state === "idle" && resendFetcher.data?.success) {
      const params = new URLSearchParams();
      params.set("page", String(logPage));
      if (searchDebounced) params.set("q", searchDebounced);
      logFetcher.load(`/app/email?${params.toString()}`);
    }
  }, [resendFetcher.state, resendFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const d = tplFetcher.data; if (!d) return; setTplMsg(d.success ? "Template saved!" : d.error); const t = setTimeout(() => setTplMsg(null), 4000); return () => clearTimeout(t); }, [tplFetcher.data]);

  // Dirty check — compare current values to the loader's latest initTpl (which refreshes
  // after a successful save via revalidation). If unchanged, Save Template is disabled.
  const isTemplateDirty =
    subject !== initTpl.subject ||
    heading !== initTpl.heading ||
    body !== initTpl.body ||
    footer !== initTpl.footer ||
    buttonColor !== initTpl.buttonColor;

  const saveTemplate = () => {
    if (!isTemplateDirty || tplFetcher.state !== "idle") return;
    tplFetcher.submit(JSON.stringify({ subject, heading, body, footer, buttonColor }), { method: "POST", action: "/api/email-template", encType: "application/json" });
  };
  const openResendPopup = (log) => {
    let fids = [];
    try { fids = JSON.parse(log.fileIds); } catch {}
    // Only pre-select files that still exist in the DB; deleted ones can't be resent.
    const availableFids = fids.filter((fid) => fileMap[fid]);
    setResendPopup({ log, selectedFileIds: availableFids, customMessage: "", customEmail: log.customerEmail });
  };
  const confirmResend = () => {
    if (!resendPopup) return;
    const payload = { logId: resendPopup.log.id };
    if (resendPopup.customMessage.trim()) payload.customMessage = resendPopup.customMessage.trim();
    if (resendPopup.customEmail.trim()) payload.customEmail = resendPopup.customEmail.trim();
    let allIds = [];
    try { allIds = JSON.parse(resendPopup.log.fileIds); } catch {}
    if (resendPopup.selectedFileIds.length < allIds.length) payload.specificFileIds = resendPopup.selectedFileIds;
    resendFetcher.submit(JSON.stringify(payload), { method: "POST", action: "/api/email-resend", encType: "application/json" });
    setResendPopup(null);
  };

  const inp = { padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: "8px", background: C.surface, color: C.text, fontSize: "14px", outline: "none", width: "100%", boxSizing: "border-box" };
  const textarea = { ...inp, minHeight: "80px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 };
  const btnP = { border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 700, fontSize: "13px", padding: "10px 22px", background: C.navy, color: "#fff", display: "inline-flex", alignItems: "center", gap: "6px" };
  const btnS = { border: `1px solid ${C.border}`, borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "13px", padding: "9px 16px", background: C.surface, color: C.text, display: "inline-flex", alignItems: "center", gap: "6px" };
  const lbl = { display: "block", marginBottom: "5px", fontWeight: 600, fontSize: "12px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px" };
  const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "20px 24px", boxShadow: C.shadow, marginBottom: "16px" };

  const TABS = [{ key: "template", label: "Email Template" }, { key: "log", label: "Delivery Log" }];
  const dynVars = ["customer_name", "order_number", "shop_name"];

  const previewHtml = () => {
    const v = { customer_name: "John", order_number: "#1042", shop_name: "My Store" };
    const r = (t) => { let o = t; for (const [k, val] of Object.entries(v)) o = o.replaceAll(`{{${k}}}`, val); return o; };
    return `<div style="font-family:-apple-system,sans-serif;border:1px solid #E1E3E5;border-radius:10px;overflow:hidden;font-size:13px">
      <div style="background:${buttonColor};padding:16px;text-align:center;color:#fff;font-weight:800;font-size:16px">My Store</div>
      <div style="padding:18px">
        <div style="font-weight:700;font-size:15px;color:#303030;margin-bottom:8px">${r(heading)}</div>
        <div style="color:#6D7175;line-height:1.7;margin-bottom:14px">${r(body)}</div>
        <div style="border:1px solid #E1E3E5;border-radius:8px;overflow:hidden;margin-bottom:14px">
          <div style="background:#F6F6F7;padding:8px 12px;font-weight:700;font-size:13px">&#128230; Premium Course</div>
          <div style="padding:8px 12px;display:flex;justify-content:space-between;align-items:center">
            <span>&#128206; Module.pdf</span>
            <span style="background:${buttonColor};color:#fff;padding:5px 14px;border-radius:5px;font-size:12px;font-weight:600">Download</span>
          </div>
        </div>
        <div style="border-top:1px solid #E1E3E5;padding-top:10px;color:#6D7175;font-size:12px">${r(footer)}</div>
      </div>
    </div>`;
  };

  return (
    <div style={{ padding: "20px 28px", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: C.text }}>

      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontWeight: 800, fontSize: "20px" }}>Email & Deliverables</div>
        <div style={{ fontSize: "13px", color: C.muted, marginTop: "3px" }}>Automated download emails sent to customers on purchase</div>
      </div>

      <div style={{ display: "flex", gap: "0", marginBottom: "24px", borderBottom: `1px solid ${C.border}` }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "10px 20px", fontSize: "13px", fontWeight: tab === t.key ? 700 : 500,
            color: tab === t.key ? C.navy : C.muted, background: "none", border: "none",
            borderBottom: tab === t.key ? `2px solid ${C.navy}` : "2px solid transparent",
            cursor: "pointer", marginBottom: "-1px",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── TEMPLATE TAB ── */}
      {tab === "template" && (
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "16px" }}>Customize Email</div>
              <div style={{ marginBottom: "14px" }}><div style={lbl}>Subject Line</div><input value={subject} onChange={(e) => setSubject(e.target.value)} style={inp} /></div>
              <div style={{ marginBottom: "14px" }}><div style={lbl}>Greeting</div><input value={heading} onChange={(e) => setHeading(e.target.value)} style={inp} /></div>
              <div style={{ marginBottom: "14px" }}><div style={lbl}>Body</div><textarea value={body} onChange={(e) => setBody(e.target.value)} style={textarea} /></div>
              <div style={{ marginBottom: "14px" }}><div style={lbl}>Footer</div><input value={footer} onChange={(e) => setFooter(e.target.value)} style={inp} /></div>
              <div style={{ marginBottom: "18px" }}>
                <div style={lbl}>Button Color</div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <input type="color" value={buttonColor} onChange={(e) => setButtonColor(e.target.value)} style={{ width: 40, height: 34, border: `1px solid ${C.border}`, borderRadius: "6px", padding: 0, cursor: "pointer" }} />
                  <input value={buttonColor} onChange={(e) => setButtonColor(e.target.value)} style={{ ...inp, width: "120px" }} />
                </div>
              </div>
              <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "10px 14px", marginBottom: "16px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: C.muted, marginBottom: "6px", textTransform: "uppercase" }}>Dynamic Variables</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {dynVars.map((v) => <span key={v} style={{ fontSize: "12px", background: C.surface, border: `1px solid ${C.border}`, padding: "3px 10px", borderRadius: "6px", color: C.accent, fontWeight: 600, fontFamily: "monospace" }}>{`{{${v}}}`}</span>)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <button
                  onClick={saveTemplate}
                  disabled={!isTemplateDirty || tplFetcher.state !== "idle"}
                  style={{ ...btnP, opacity: (!isTemplateDirty || tplFetcher.state !== "idle") ? 0.5 : 1, cursor: (!isTemplateDirty || tplFetcher.state !== "idle") ? "not-allowed" : "pointer" }}
                >
                  {tplFetcher.state !== "idle" ? "Saving..." : "Save Template"}
                </button>
                {tplMsg && <span style={{ fontSize: "13px", color: tplFetcher.data?.success ? C.success : C.danger, fontWeight: 600 }}>{tplMsg}</span>}
              </div>
            </div>
          </div>
          <div style={{ width: "380px", flexShrink: 0 }}>
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: "13px", color: C.muted, marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Live Preview</div>
              <div dangerouslySetInnerHTML={{ __html: previewHtml() }} />
            </div>
          </div>
        </div>
      )}

      {/* ── DELIVERY LOG TAB ── */}
      {tab === "log" && (
        <div>
          {/* Search bar — always visible when the log tab is open (even if no results). */}
          <div style={{ marginBottom: "14px", display: "flex", gap: "10px", alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1, maxWidth: "420px" }}>
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by customer, email, product, or file name…"
                style={{ ...inp, paddingLeft: "34px" }}
              />
              <span style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: "14px", pointerEvents: "none" }}>⌕</span>
              {searchInput && (
                <button
                  onClick={() => setSearchInput("")}
                  style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: "16px", padding: "0 4px", lineHeight: 1 }}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
            {logFetcher.state !== "idle" && (
              <span style={{ fontSize: "12px", color: C.muted }}>Loading…</span>
            )}
          </div>

          {!initLogs.length ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", textAlign: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: "14px", background: C.surface, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", color: C.faint, boxShadow: C.shadow, marginBottom: "16px" }}>&#9993;</div>
              <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "6px" }}>
                {searchDebounced ? "No matching emails" : "No emails sent yet"}
              </div>
              <div style={{ fontSize: "14px", color: C.muted, maxWidth: "340px", lineHeight: 1.7 }}>
                {searchDebounced
                  ? `No emails match "${searchDebounced}". Try a different search term.`
                  : "When a customer places an order with digital products, an email with download links will be sent automatically."}
              </div>
            </div>
          ) : (
            <div style={{ ...card, padding: 0, overflow: "hidden", opacity: logFetcher.state !== "idle" ? 0.65 : 1, transition: "opacity 0.15s" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: "14px" }}>
                {searchDebounced ? `Matches: ${pagination?.total ?? initLogs.length}` : `Recent Emails (${pagination?.total ?? initLogs.length})`}
              </div>
              {initLogs.map((log, idx) => {
                const statusColor = log.status === "failed" ? C.danger : C.success;
                const statusBg = log.status === "failed" ? C.dangerBg : C.successBg;
                const statusBdr = log.status === "failed" ? C.dangerBdr : C.successBdr;
                const statusIcon = log.status === "failed" ? "✗" : "✓";
                const statusLabel = log.status === "resent" ? "Resent" : log.status === "sent" ? "Sent" : "Failed";
                return (
                  <div key={log.id} style={{ display: "flex", alignItems: "center", padding: "12px 20px", borderBottom: idx < initLogs.length - 1 ? `1px solid ${C.border}` : "none", gap: "14px" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "9px", background: statusBg, border: `1px solid ${statusBdr}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", flexShrink: 0 }}>{statusIcon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "14px" }}>{log.customerName} <span style={{ fontWeight: 400, color: C.muted, fontSize: "12px" }}>({log.customerEmail})</span></div>
                      <div style={{ fontSize: "12px", color: C.muted, marginTop: "2px" }}>{log.productTitle} &middot; {log.orderNumber} &middot; {new Date(log.createdAt).toLocaleDateString()}</div>
                      {log.error && <div style={{ fontSize: "11px", color: C.danger, marginTop: "3px" }}>{log.error}</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: "6px", background: statusBg, color: statusColor, border: `1px solid ${statusBdr}` }}>{statusLabel}</span>
                      <button onClick={() => openResendPopup(log)} disabled={resendFetcher.state !== "idle"} style={{ ...btnS, padding: "6px 12px", fontSize: "12px" }}>Resend</button>
                    </div>
                  </div>
                );
              })}
              {resendFetcher.data?.success && <div style={{ padding: "10px 20px", background: C.successBg, color: C.success, fontSize: "13px", fontWeight: 600, borderTop: `1px solid ${C.successBdr}` }}>Email resent successfully!</div>}
              {resendFetcher.data?.error && <div style={{ padding: "10px 20px", background: C.dangerBg, color: C.danger, fontSize: "13px", borderTop: `1px solid ${C.dangerBdr}` }}>{resendFetcher.data.error}</div>}
            </div>
          )}

          {/* Pagination controls */}
          {pagination && pagination.totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "14px", padding: "10px 4px" }}>
              <div style={{ fontSize: "12px", color: C.muted }}>
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} {pagination.total === 1 ? "email" : "emails"}
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1 || logFetcher.state !== "idle"}
                  style={{ ...btnS, padding: "6px 12px", fontSize: "12px", opacity: pagination.page <= 1 ? 0.4 : 1, cursor: pagination.page <= 1 ? "not-allowed" : "pointer" }}
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setLogPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={pagination.page >= pagination.totalPages || logFetcher.state !== "idle"}
                  style={{ ...btnS, padding: "6px 12px", fontSize: "12px", opacity: pagination.page >= pagination.totalPages ? 0.4 : 1, cursor: pagination.page >= pagination.totalPages ? "not-allowed" : "pointer" }}
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* Resend popup */}
          {resendPopup && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "28px 32px", maxWidth: "480px", width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>
                <div style={{ fontSize: "18px", fontWeight: 800, marginBottom: "6px" }}>Resend Email</div>
                <div style={{ fontSize: "13px", color: C.muted, marginBottom: "18px" }}>
                  {resendPopup.log.customerName} &middot; {resendPopup.log.orderNumber}
                </div>

                {/* Send to email */}
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Send to email</div>
                  <input value={resendPopup.customEmail} onChange={(e) => setResendPopup((p) => ({ ...p, customEmail: e.target.value }))} style={inp} placeholder={resendPopup.log.customerEmail} />
                  <div style={{ fontSize: "11px", color: C.faint, marginTop: "4px" }}>Change if the customer requested a different email address</div>
                </div>

                {/* File selection — filter out files that have been deleted from the DB. */}
                {(() => {
                  let allFids = [];
                  try { allFids = JSON.parse(resendPopup.log.fileIds); } catch {}
                  const availableFids = allFids.filter((fid) => fileMap[fid]);
                  const deletedCount = allFids.length - availableFids.length;

                  if (allFids.length === 0) return null;

                  if (availableFids.length === 0) {
                    return (
                      <div style={{ marginBottom: "16px", padding: "12px 14px", background: C.dangerBg, border: `1px solid ${C.dangerBdr}`, borderRadius: "8px", color: C.danger, fontSize: "13px" }}>
                        All files from this email have been deleted. This email cannot be resent.
                      </div>
                    );
                  }

                  return (
                    <div style={{ marginBottom: "16px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>Select files to send</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                        {availableFids.map((fid) => {
                          const checked = resendPopup.selectedFileIds.includes(fid);
                          const name = fileMap[fid];
                          return (
                            <label key={fid} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", border: `1px solid ${checked ? C.navy : C.border}`, borderRadius: "8px", background: checked ? "rgba(27,43,68,0.03)" : C.surface, cursor: "pointer" }}>
                              <input type="checkbox" checked={checked} onChange={() => {
                                setResendPopup((p) => ({ ...p, selectedFileIds: checked ? p.selectedFileIds.filter((id) => id !== fid) : [...p.selectedFileIds, fid] }));
                              }} style={{ width: 15, height: 15, accentColor: C.navy }} />
                              <span style={{ fontSize: "13px", fontWeight: 500 }}>{name}</span>
                            </label>
                          );
                        })}
                      </div>
                      {deletedCount > 0 && (
                        <div style={{ fontSize: "11px", color: C.muted, marginTop: "8px", fontStyle: "italic" }}>
                          {deletedCount} {deletedCount === 1 ? "file has" : "files have"} been deleted and cannot be resent.
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Custom message */}
                <div style={{ marginBottom: "18px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Custom message (optional)</div>
                  <textarea value={resendPopup.customMessage} onChange={(e) => setResendPopup((p) => ({ ...p, customMessage: e.target.value }))} placeholder="e.g. Here's the file you requested..." style={{ ...textarea, minHeight: "60px" }} />
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button onClick={() => setResendPopup(null)} style={{ ...btnS, padding: "10px 20px", fontSize: "13px" }}>Cancel</button>
                  <button onClick={confirmResend} disabled={!resendPopup.selectedFileIds.length || resendFetcher.state !== "idle"} style={{ ...btnP, opacity: resendPopup.selectedFileIds.length && resendFetcher.state === "idle" ? 1 : 0.4 }}>
                    {resendFetcher.state !== "idle" ? "Sending..." : "Send Email"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
