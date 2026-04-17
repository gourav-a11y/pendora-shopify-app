/**
 * Setup Guide for first-time Pendora merchants.
 *
 * Mirrors Shopify's Setup Guide composition pattern
 * (https://shopify.dev/docs/api/app-home/patterns/compositions/setup-guide):
 *   - Expandable checklist card on the home route (not a blocking modal).
 *   - Progress counter "X of N completed".
 *   - Per-step CTA with deep-link; completion auto-derived from app data.
 *   - Dismiss (×) + collapse (⌃) controls — state persisted by the parent.
 *
 * Purely presentational. Parent owns all state (dismissed, collapsed, step
 * completion) and passes handlers down. Style matches the rest of the
 * dashboard (custom inline styles on the Pendora navy/amber theme).
 */

function Checkmark({ size = 11, color = "#fff" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CloseIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function Chevron({ size = 14, flipped = false }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: flipped ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SparkIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.8 5.4L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.6z" />
      <path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
      <path d="M5 3l.5 1.5 1.5.5-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z" />
    </svg>
  );
}

export default function OnboardingGuide({
  steps,                  // [{ id, title, description, ctaLabel, completed, onClick }]
  completedCount,
  totalSteps,
  allComplete,
  collapsed,
  onToggleCollapse,
  onDismiss,
  theme,                  // Pendora theme tokens (t) — colors
}) {
  const t = theme;
  const progressPct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

  // Celebratory variant — all 3 steps done, just needs a dismiss acknowledgement.
  if (allComplete) {
    return (
      <div
        role="region"
        aria-label="Pendora setup complete"
        style={{
          background: t.surface,
          border: `1px solid ${t.successBdr}`,
          borderRadius: "14px",
          padding: "22px 24px",
          boxShadow: t.shadow,
          marginBottom: "18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px", flex: 1 }}>
          <div style={{ width: 44, height: 44, borderRadius: "11px", background: t.successBg, border: `1px solid ${t.successBdr}`, color: t.success, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Checkmark size={18} color={t.success} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: "15px", color: t.text, marginBottom: "2px" }}>You&rsquo;re all set!</div>
            <div style={{ fontSize: "13px", color: t.muted }}>Pendora is delivering digital files to your customers automatically.</div>
          </div>
        </div>
        <button
          onClick={onDismiss}
          style={{ border: `1px solid ${t.border}`, background: t.surface, color: t.text, padding: "8px 14px", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: "pointer", flexShrink: 0 }}
        >
          Got it
        </button>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Pendora setup guide"
      style={{
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: "14px",
        boxShadow: t.shadow,
        marginBottom: "18px",
        overflow: "hidden",
      }}
    >
      {/* Progress bar at the very top — visual affordance of completion */}
      <div style={{ height: "3px", background: t.border, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            inset: "0 auto 0 0",
            width: `${progressPct}%`,
            background: t.accent,
            transition: "width 0.35s ease",
          }}
        />
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "11px", flex: 1, minWidth: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: "10px", background: t.pill, display: "flex", alignItems: "center", justifyContent: "center", color: t.accent, flexShrink: 0 }}>
            <SparkIcon size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: "15px", color: t.text }}>Getting started with Pendora</div>
            <div style={{ fontSize: "12px", color: t.muted, marginTop: "2px" }}>
              {completedCount} of {totalSteps} {totalSteps === 1 ? "step" : "steps"} completed
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
          <button
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand setup guide" : "Collapse setup guide"}
            style={{ background: "none", border: "none", color: t.muted, cursor: "pointer", padding: "6px 8px", borderRadius: "6px", display: "flex", alignItems: "center" }}
          >
            <Chevron size={14} flipped={collapsed} />
          </button>
          <button
            onClick={onDismiss}
            aria-label="Dismiss setup guide"
            style={{ background: "none", border: "none", color: t.muted, cursor: "pointer", padding: "6px 8px", borderRadius: "6px", display: "flex", alignItems: "center" }}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      </div>

      {/* Steps list — hidden when collapsed */}
      {!collapsed && (
        <div style={{ borderTop: `1px solid ${t.border}` }}>
          {steps.map((step, i) => (
            <div
              key={step.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "14px",
                padding: "16px 20px",
                borderBottom: i < steps.length - 1 ? `1px solid ${t.border}` : "none",
                background: step.completed ? "rgba(0,128,96,0.03)" : "transparent",
              }}
            >
              {/* Check circle */}
              <div
                aria-hidden="true"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: step.completed ? t.success : "transparent",
                  border: step.completed ? `1px solid ${t.success}` : `1.5px solid ${t.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: "1px",
                  transition: "background 0.2s, border-color 0.2s",
                }}
              >
                {step.completed && <Checkmark size={11} color="#fff" />}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "14px",
                    color: step.completed ? t.muted : t.text,
                    textDecoration: step.completed ? "line-through" : "none",
                    marginBottom: "4px",
                  }}
                >
                  {step.title}
                </div>
                <div style={{ fontSize: "13px", color: t.muted, lineHeight: 1.55, marginBottom: "10px" }}>
                  {step.description}
                </div>
                {!step.completed && step.ctaLabel && (
                  <button
                    onClick={step.onClick}
                    style={{
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "13px",
                      padding: "8px 16px",
                      background: t.active,
                      color: t.accentText,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    {step.ctaLabel}
                  </button>
                )}
                {step.completed && (
                  <span style={{ fontSize: "12px", color: t.success, fontWeight: 600 }}>Completed</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
