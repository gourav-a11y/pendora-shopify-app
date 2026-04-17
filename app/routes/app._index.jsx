import { useState, useEffect } from "react";
import { useLoaderData, useNavigate, useRouteError, isRouteErrorResponse } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import OnboardingGuide from "../components/OnboardingGuide";

// ── Theme tokens (kept identical to /app/digital-products for visual continuity) ──
const T = {
  bg:         '#F6F6F7',
  surface:    '#FFFFFF',
  border:     '#E1E3E5',
  accent:     '#F5A524',
  accentText: '#FFFFFF',
  active:     '#1B2B44',
  text:       '#303030',
  muted:      '#6D7175',
  faint:      '#999EA3',
  danger:     '#D72C0D',
  dangerBg:   '#FFF4F4',
  dangerBdr:  '#FDBDBD',
  success:    '#008060',
  successBg:  '#F1F8F5',
  successBdr: '#AEE9D1',
  shadow:     '0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
  pill:       'rgba(27,43,68,0.07)',
};

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const n = Number(bytes);
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // All quick stats + recent activity + onboarding flags in one parallel batch.
  const [filesAgg, productGroups, sentEmailCount, totalEmailCount, recentLogs, templateRow] = await Promise.all([
    prisma.productFile.aggregate({
      where: { shop },
      _count: { _all: true },
      _sum: { fileSize: true },
    }),
    prisma.productFile.groupBy({
      where: { shop },
      by: ["productId"],
    }),
    prisma.emailLog.count({ where: { shop, status: "sent" } }),
    prisma.emailLog.count({ where: { shop } }),
    prisma.emailLog.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, customerName: true, customerEmail: true, productTitle: true, status: true, createdAt: true },
    }),
    prisma.emailTemplate.findUnique({
      where: { shop },
      select: { id: true },
    }),
  ]);

  const totalFiles = filesAgg._count._all;
  // Prisma BigInt sum needs careful coercion.
  const totalSizeBytes = filesAgg._sum.fileSize ? Number(filesAgg._sum.fileSize) : 0;
  const totalProducts = productGroups.length;

  const shopName = shop.replace(".myshopify.com", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    shopName,
    stats: {
      totalProducts,
      totalFiles,
      totalSize: formatBytes(totalSizeBytes),
      totalEmails: totalEmailCount,
    },
    recentLogs: recentLogs.map((l) => ({
      id: l.id,
      customerName: l.customerName,
      customerEmail: l.customerEmail,
      productTitle: l.productTitle,
      status: l.status,
      createdAt: l.createdAt.toISOString(),
    })),
    onboarding: {
      hasProduct: totalProducts > 0,
      hasEmailTemplate: !!templateRow,
      hasSentEmail: sentEmailCount > 0,
    },
  };
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomeDashboard() {
  const { shopName, stats, recentLogs, onboarding } = useLoaderData();
  const navigate = useNavigate();

  // Onboarding dismissal — persisted per-browser via localStorage. Hydration-gated
  // so a previously-dismissed card never flashes on initial paint.
  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("pendora_onboarding_dismissed") === "true") setDismissed(true);
      if (localStorage.getItem("pendora_onboarding_collapsed") === "true") setCollapsed(true);
    } catch {}
    setHydrated(true);
  }, []);
  const dismissOnboarding = () => {
    setDismissed(true);
    try { localStorage.setItem("pendora_onboarding_dismissed", "true"); } catch {}
  };
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("pendora_onboarding_collapsed", next ? "true" : "false"); } catch {}
      return next;
    });
  };

  const onboardingSteps = [
    {
      id: "add-product",
      title: "Create your first digital product",
      description: "Attach a PDF, ZIP, MP3, or any digital file to a Shopify product. Customers get it instantly after purchase.",
      ctaLabel: "Add Product",
      completed: onboarding.hasProduct,
      onClick: () => navigate("/app/digital-products"),
    },
    {
      id: "customize-email",
      title: "Customize your delivery email",
      description: "Brand the download email your customers receive — change the subject, message, and button color.",
      ctaLabel: "Customize email",
      completed: onboarding.hasEmailTemplate,
      onClick: () => navigate("/app/email"),
    },
    {
      id: "first-delivery",
      title: "Your first customer delivery",
      description: "When a customer buys a digital product, Pendora automatically emails them a download link. You'll see it here once it happens.",
      ctaLabel: "View delivery log",
      completed: onboarding.hasSentEmail,
      onClick: () => navigate("/app/email"),
    },
  ];
  const completedCount = onboardingSteps.filter((s) => s.completed).length;
  const allComplete = completedCount === onboardingSteps.length;
  const showOnboarding = hydrated && !dismissed;

  const statCard = {
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: "12px",
    padding: "16px 18px",
    boxShadow: T.shadow,
    minWidth: 0,
  };

  const quickAction = {
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: "12px",
    padding: "16px 18px",
    boxShadow: T.shadow,
    cursor: "pointer",
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    fontFamily: "inherit",
    color: T.text,
    transition: "border-color 0.15s, transform 0.12s",
    minWidth: 0,
  };

  const statusStyle = (status) => {
    if (status === "failed") return { bg: T.dangerBg, color: T.danger, bdr: T.dangerBdr, label: "Failed" };
    if (status === "resent") return { bg: "#FFF7E6", color: "#B45309", bdr: "#FCD34D", label: "Resent" };
    return { bg: T.successBg, color: T.success, bdr: T.successBdr, label: "Sent" };
  };

  return (
    <div className="pendora-noscroll" style={{ position: "fixed", inset: 0, background: T.bg, color: T.text, overflow: "auto", scrollbarWidth: "none", msOverflowStyle: "none", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{`.pendora-noscroll::-webkit-scrollbar { width: 0; height: 0; display: none; }`}</style>
      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "clamp(16px, 4vw, 28px) clamp(14px, 4vw, 28px) 60px" }}>

        {/* ── Page heading ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: "22px" }}>
          <div style={{ fontSize: "clamp(18px, 4.5vw, 22px)", fontWeight: 800, color: T.text, lineHeight: 1.25, wordBreak: "break-word" }}>
            Welcome to Pendora{shopName ? `, ${shopName}` : ""}
          </div>
          <div style={{ fontSize: "clamp(13px, 3.5vw, 14px)", color: T.muted, marginTop: "4px", lineHeight: 1.5 }}>
            Manage your digital products, files, and customer delivery emails — all from one place.
          </div>
        </div>

        {/* ── Setup Guide (onboarding) ─────────────────────────────────── */}
        {showOnboarding && (
          <OnboardingGuide
            steps={onboardingSteps}
            completedCount={completedCount}
            totalSteps={onboardingSteps.length}
            allComplete={allComplete}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapsed}
            onDismiss={dismissOnboarding}
            theme={T}
          />
        )}

        {/* ── Quick stats ──────────────────────────────────────────────── */}
        <div style={{ marginBottom: "22px" }}>
          <div style={{ fontWeight: 700, fontSize: "14px", color: T.text, marginBottom: "10px", letterSpacing: "0.2px" }}>Overview</div>
          {/* Grid w/ auto-fit: 2 cols on phones, 4 on tablets+. No media queries needed. */}
          <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <div style={statCard}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Digital Products</div>
              <div style={{ fontSize: "24px", fontWeight: 800, color: T.text, lineHeight: 1.1 }}>{stats.totalProducts}</div>
            </div>
            <div style={statCard}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Files</div>
              <div style={{ fontSize: "24px", fontWeight: 800, color: T.text, lineHeight: 1.1 }}>{stats.totalFiles}</div>
            </div>
            <div style={statCard}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Storage Used</div>
              <div style={{ fontSize: "24px", fontWeight: 800, color: T.text, lineHeight: 1.1 }}>{stats.totalSize}</div>
            </div>
            <div style={statCard}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Emails Sent</div>
              <div style={{ fontSize: "24px", fontWeight: 800, color: T.text, lineHeight: 1.1 }}>{stats.totalEmails}</div>
            </div>
          </div>
        </div>

        {/* ── Quick actions ────────────────────────────────────────────── */}
        <div style={{ marginBottom: "22px" }}>
          <div style={{ fontWeight: 700, fontSize: "14px", color: T.text, marginBottom: "10px", letterSpacing: "0.2px" }}>Quick actions</div>
          {/* Grid w/ auto-fit: 1 col on phones, 2-3 on tablets+. No media queries needed. */}
          <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <button onClick={() => navigate("/app/digital-products")} style={quickAction}>
              <div style={{ width: 38, height: 38, borderRadius: "10px", background: T.pill, display: "flex", alignItems: "center", justifyContent: "center", color: T.accent, flexShrink: 0 }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "14px", color: T.text }}>Add a digital product</div>
                <div style={{ fontSize: "12px", color: T.muted, marginTop: "2px" }}>Attach files to a Shopify product</div>
              </div>
            </button>
            <button onClick={() => navigate("/app/email")} style={quickAction}>
              <div style={{ width: 38, height: 38, borderRadius: "10px", background: T.pill, display: "flex", alignItems: "center", justifyContent: "center", color: T.accent, flexShrink: 0 }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "14px", color: T.text }}>Customize email</div>
                <div style={{ fontSize: "12px", color: T.muted, marginTop: "2px" }}>Brand your download emails</div>
              </div>
            </button>
            <button onClick={() => navigate("/app/files")} style={quickAction}>
              <div style={{ width: 38, height: 38, borderRadius: "10px", background: T.pill, display: "flex", alignItems: "center", justifyContent: "center", color: T.accent, flexShrink: 0 }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "14px", color: T.text }}>Manage files</div>
                <div style={{ fontSize: "12px", color: T.muted, marginTop: "2px" }}>Search, replace, and delete uploads</div>
              </div>
            </button>
          </div>
        </div>

        {/* ── Recent activity ──────────────────────────────────────────── */}
        <div style={{ marginBottom: "22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <div style={{ fontWeight: 700, fontSize: "14px", color: T.text, letterSpacing: "0.2px" }}>Recent deliveries</div>
            {recentLogs.length > 0 && (
              <button
                onClick={() => navigate("/app/email")}
                style={{ background: "none", border: "none", color: T.active, fontWeight: 600, fontSize: "12px", cursor: "pointer", padding: "2px 4px" }}
              >
                View all →
              </button>
            )}
          </div>
          {recentLogs.length === 0 ? (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: "12px", padding: "28px", textAlign: "center", color: T.muted, fontSize: "13px", boxShadow: T.shadow }}>
              No customer deliveries yet. Customer download emails will appear here once your first order is placed.
            </div>
          ) : (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: "12px", boxShadow: T.shadow, overflow: "hidden" }}>
              {recentLogs.map((log, idx) => {
                const s = statusStyle(log.status);
                return (
                  <div key={log.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 18px", borderBottom: idx < recentLogs.length - 1 ? `1px solid ${T.border}` : "none" }}>
                    <div style={{ width: 32, height: 32, borderRadius: "8px", background: s.bg, border: `1px solid ${s.bdr}`, color: s.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "14px", flexShrink: 0 }}>
                      {log.status === "failed" ? "✗" : "✓"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {log.customerName} <span style={{ fontWeight: 400, color: T.muted, fontSize: "12px" }}>({log.customerEmail})</span>
                      </div>
                      <div style={{ fontSize: "12px", color: T.muted, marginTop: "2px" }}>
                        {log.productTitle} · {new Date(log.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </div>
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "6px", background: s.bg, color: s.color, border: `1px solid ${s.bdr}`, flexShrink: 0 }}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ─── Error Boundary ───────────────────────────────────────────────────────────

export function ErrorBoundary() {
  const error = useRouteError();
  const statusCode = isRouteErrorResponse(error) ? error.status : null;
  const message = isRouteErrorResponse(error)
    ? (error.data?.message || error.statusText || "An error occurred.")
    : error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <div style={{ textAlign: "center", padding: "40px 20px", fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {statusCode && <p style={{ fontSize: "48px", fontWeight: 700, color: "#d72c0d", margin: "0 0 8px" }}>{statusCode}</p>}
      <p style={{ color: "#6d7175", marginBottom: "24px" }}>{message}</p>
      <button onClick={() => window.location.reload()} style={{ padding: "10px 24px", borderRadius: "8px", border: "1px solid #ccc", cursor: "pointer", fontSize: "14px" }}>Reload Page</button>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
