import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy, AlertTriangle, XCircle, Cpu, FolderSearch, ChevronRight } from "lucide-react";
import type { VaultEntry, SystemStatus, HealthReport, Settings, FolderScanSession, LibraryFilter } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import { copyTextToClipboard } from "../../lib/clipboard";
import { addedWithin, cumulative, dailyCounts, healthScore, orderChecks, previewOf, relativeTime, sparkPoints } from "./homeStats";

type T = (key: keyof TranslationDict) => string;

/** Fill "{n}"-style placeholders. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const FAMILY_TONE: Record<VaultEntry["family"], { tag: string; fg: string; bg: string }> = {
  secret: { tag: "KEY", fg: "var(--amber)", bg: "var(--amber-bg)" },
  command: { tag: "CMD", fg: "var(--cyan)", bg: "var(--cyan-bg)" },
  note: { tag: "NOTE", fg: "var(--violet)", bg: "var(--violet-bg)" },
  unknown: { tag: "ITEM", fg: "var(--accent-bright)", bg: "var(--accent-bg)" },
};

/* ── KPI tiles ─────────────────────────────────────────────────────────── */

export function KpiTiles({
  entries,
  status,
  encrypted,
  t,
  onOpen,
}: {
  entries: VaultEntry[];
  status: SystemStatus | null;
  encrypted: boolean;
  t: T;
  onOpen: (filter: LibraryFilter) => void;
}) {
  const tiles = useMemo(() => {
    const saved = entries.filter((e) => e.status === "saved");
    const of = (fam: VaultEntry["family"]) => saved.filter((e) => e.family === fam);
    const series = (list: VaultEntry[]) => {
      const days = dailyCounts(list, 14);
      const inWindow = days.reduce((a, b) => a + b, 0);
      return sparkPoints(cumulative(days, Math.max(0, list.length - inWindow)), 96, 32);
    };
    const week = (list: VaultEntry[]) => addedWithin(list, 7);
    const stats = status?.stats;
    const pending = stats?.needs_attention ?? entries.filter((e) => e.status !== "saved").length;
    return [
      {
        key: "all" as LibraryFilter,
        label: t("kpi_entries"),
        value: stats?.total_saved ?? saved.length,
        color: "var(--accent-bright)",
        delta: week(saved),
        note: fill(t("kpi_entries_note"), { n: stats?.total_notes ?? of("note").length }),
        points: series(saved),
      },
      {
        key: "secret" as LibraryFilter,
        label: t("kpi_secrets"),
        value: stats?.total_secrets ?? of("secret").length,
        color: "var(--amber)",
        delta: week(of("secret")),
        note: encrypted ? t("kpi_secrets_enc") : t("kpi_secrets_plain"),
        points: series(of("secret")),
      },
      {
        key: "command" as LibraryFilter,
        label: t("kpi_commands"),
        value: stats?.total_commands ?? of("command").length,
        color: "var(--cyan)",
        delta: week(of("command")),
        note: t("kpi_commands_note"),
        points: series(of("command")),
      },
      {
        key: "attention" as LibraryFilter,
        label: t("kpi_review"),
        value: pending,
        color: "var(--violet)",
        delta: 0,
        note: pending ? t("kpi_review_note") : t("kpi_review_none"),
        points: "",
      },
    ];
  }, [entries, status, encrypted, t]);

  return (
    <section className="grid gap-4 grid-cols-2 xl:grid-cols-4" aria-label={t("vault_overview")}>
      {tiles.map((k) => (
        <button
          key={k.key}
          type="button"
          onClick={() => onOpen(k.key)}
          title={t("kpi_open_title")}
          className="app-card kpi-tile p-4 flex flex-col gap-2 text-start cursor-pointer"
        >
          <div className="flex items-center gap-2 w-full">
            <span className="w-2 h-2 rounded-[3px]" style={{ background: k.color }} />
            <span className="text-[13px] font-medium" style={{ color: "var(--text-dim)" }}>{k.label}</span>
            {k.delta > 0 && (
              <span className="ms-auto hidden sm:inline text-[11px] font-semibold whitespace-nowrap" style={{ color: "var(--emerald)" }}>
                {fill(t("kpi_added_week"), { n: k.delta })}
              </span>
            )}
          </div>
          <div className="flex items-end justify-between gap-3 w-full">
            <span className="text-3xl font-bold tabular-nums tracking-tight" style={{ color: "var(--text)" }}>{k.value}</span>
            {k.points && (
              <svg width="96" height="32" viewBox="0 0 96 32" aria-hidden="true" className="flex-shrink-0">
                <polyline points={k.points} fill="none" stroke={k.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{k.note}</span>
        </button>
      ))}
    </section>
  );
}

/* ── Health ────────────────────────────────────────────────────────────── */

export function HealthCard({ health, t, onOpenDetails }: { health: HealthReport | null; t: T; onOpenDetails: () => void }) {
  const score = healthScore(health?.checks);
  const checks = orderChecks(health?.checks).slice(0, 5);
  const bad = (health?.checks ?? []).filter((c) => !c.ok).length;
  const ringColor = score == null ? "var(--text-muted)" : score >= 90 ? "var(--emerald)" : score >= 60 ? "var(--amber)" : "var(--danger)";
  const C = 2 * Math.PI * 34;

  return (
    <section className="app-card p-5 flex flex-col gap-4" aria-labelledby="home-health">
      <div className="flex items-center gap-4">
        <svg width="76" height="76" viewBox="0 0 84 84" role="img" aria-label={fill(t("health_card_score"), { n: score ?? "–" })} className="flex-shrink-0">
          <circle cx="42" cy="42" r="34" fill="none" stroke="var(--border)" strokeWidth="8" />
          <circle
            cx="42"
            cy="42"
            r="34"
            fill="none"
            stroke={ringColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${((score ?? 0) / 100) * C} ${C}`}
            transform="rotate(-90 42 42)"
            style={{ transition: "stroke-dasharray 0.6s ease" }}
          />
          <text x="42" y="49" textAnchor="middle" fill="var(--text)" fontSize="20" fontWeight="700">
            {score ?? "–"}
          </text>
        </svg>
        <div className="flex flex-col gap-1 min-w-0">
          <h2 id="home-health" className="text-base font-semibold" style={{ color: "var(--text)" }}>{t("health_card_title")}</h2>
          <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            {bad ? fill(t("health_card_issues"), { n: bad }) : t("health_card_ok")}
          </span>
        </div>
      </div>
      {checks.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {checks.map((c) => (
            <li key={c.id} className="flex items-center gap-2.5 text-[13px]" title={c.detail} dir="auto">
              {c.ok ? (
                <Check className="w-4 h-4 flex-shrink-0" style={{ color: "var(--emerald)" }} aria-hidden="true" />
              ) : c.severity === "critical" ? (
                <XCircle className="w-4 h-4 flex-shrink-0" style={{ color: "var(--danger)" }} aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "var(--amber)" }} aria-hidden="true" />
              )}
              <span className="flex-1 truncate" style={{ color: "var(--text)" }}>{c.label}</span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onOpenDetails}
        className="icon-btn self-start flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold"
        style={{ borderColor: "var(--border)", color: "var(--accent-bright)" }}
      >
        {t("health_card_details")} <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
      </button>
    </section>
  );
}

/* ── Vault mix ─────────────────────────────────────────────────────────── */

export function VaultMixCard({ status, t }: { status: SystemStatus | null; t: T }) {
  const s = status?.stats;
  const parts = [
    { label: t("mix_commands"), n: s?.total_commands ?? 0, color: "var(--cyan)" },
    { label: t("mix_notes"), n: s?.total_notes ?? 0, color: "var(--violet)" },
    { label: t("mix_secrets"), n: s?.total_secrets ?? 0, color: "var(--amber)" },
    { label: t("mix_other"), n: s?.total_unknown ?? 0, color: "var(--accent-bright)" },
  ];
  const total = parts.reduce((a, p) => a + p.n, 0);

  return (
    <section className="app-card p-5 flex flex-col gap-3.5" aria-labelledby="home-mix">
      <h2 id="home-mix" className="text-base font-semibold" style={{ color: "var(--text)" }}>{t("mix_title")}</h2>
      {total === 0 ? (
        <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>{t("mix_empty")}</span>
      ) : (
        <>
          <div
            className="flex h-2.5 rounded-full overflow-hidden gap-0.5"
            role="img"
            aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")}
          >
            {parts
              .filter((p) => p.n > 0)
              .map((p) => (
                <div key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: p.color, transition: "width 0.5s ease" }} />
              ))}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            {parts.map((p) => (
              <div key={p.label} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-[3px]" style={{ background: p.color }} />
                <span className="flex-1" style={{ color: "var(--text-dim)" }}>{p.label}</span>
                <span className="tabular-nums" style={{ color: "var(--text)" }}>{p.n}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/* ── Background services ───────────────────────────────────────────────── */

export function ServicesCard({
  status,
  settings,
  scanSession,
  t,
  onOpenFolders,
  onOpenSettings,
}: {
  status: SystemStatus | null;
  settings: Settings | null;
  scanSession: FolderScanSession | null;
  t: T;
  onOpenFolders: () => void;
  onOpenSettings: () => void;
}) {
  const provider = status?.active_provider || status?.ai_provider || "";
  const rulesOnly = !provider || provider === "heuristic" || provider === "none";
  const isLocal = provider === "local" || provider === "ollama" || provider === "auto";
  const aiReady = !rulesOnly && (isLocal ? !!status?.is_ollama_online : true);
  const model = isLocal ? settings?.ollama_llm_model : provider;
  const aiSub = rulesOnly ? t("services_rules") : [isLocal ? "Ollama" : provider, model].filter(Boolean).join(" · ");
  const toReview = scanSession?.status === "review" ? scanSession.summary.candidates_needs_review : 0;

  const Row = ({
    icon,
    tone,
    title,
    sub,
    state,
    stateColor,
    onClick,
  }: {
    icon: ReactNode;
    tone: { fg: string; bg: string };
    title: string;
    sub: string;
    state: string;
    stateColor: string;
    onClick: () => void;
  }) => (
    <button type="button" onClick={onClick} className="service-row flex items-center gap-3 w-full text-start rounded-xl -mx-2 px-2 py-1.5">
      <span className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0" style={{ background: tone.bg, color: tone.fg }}>
        {icon}
      </span>
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</span>
        <span className="text-xs truncate font-mono" style={{ color: "var(--text-muted)" }} dir="auto">{sub}</span>
      </span>
      <span className="text-xs font-semibold" style={{ color: stateColor }}>{state}</span>
    </button>
  );

  return (
    <section className="app-card p-5 flex flex-col gap-3" aria-labelledby="home-services">
      <h2 id="home-services" className="text-base font-semibold" style={{ color: "var(--text)" }}>{t("services_title")}</h2>
      <Row
        icon={<Cpu className="w-[18px] h-[18px]" aria-hidden="true" />}
        tone={{ fg: "var(--accent-bright)", bg: "var(--accent-bg)" }}
        title={t("services_ai")}
        sub={aiSub || "—"}
        state={rulesOnly ? t("services_basic") : aiReady ? t("services_ready") : t("services_offline")}
        stateColor={aiReady ? "var(--emerald)" : rulesOnly ? "var(--text-muted)" : "var(--amber)"}
        onClick={onOpenSettings}
      />
      <Row
        icon={<FolderSearch className="w-[18px] h-[18px]" aria-hidden="true" />}
        tone={{ fg: "var(--cyan)", bg: "var(--cyan-bg)" }}
        title={t("services_watcher")}
        sub={scanSession ? scanSession.folder_path : t("services_no_scan")}
        state={toReview ? fill(t("services_to_review"), { n: toReview }) : scanSession?.watching ? t("services_watching") : t("services_idle")}
        stateColor={toReview ? "var(--amber)" : scanSession?.watching ? "var(--emerald)" : "var(--text-muted)"}
        onClick={onOpenFolders}
      />
    </section>
  );
}

/* ── Recently saved ────────────────────────────────────────────────────── */

export function RecentList({
  entries,
  lang,
  t,
  onOpenLibrary,
}: {
  entries: VaultEntry[];
  lang: "en" | "ar";
  t: T;
  onOpenLibrary: () => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      entries
        .filter((e) => e.status === "saved")
        .sort((a, b) => Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at))
        .slice(0, 8),
    [entries]
  );

  const copy = async (e: VaultEntry) => {
    const ok = await copyTextToClipboard(e.value, { sensitive: e.family === "secret" });
    if (ok) {
      setCopiedId(e.id);
      setTimeout(() => setCopiedId((id) => (id === e.id ? null : id)), 1500);
    }
  };

  return (
    <section className="app-card py-2" aria-labelledby="home-recent">
      <div className="flex items-center px-5 pt-3 pb-2">
        <h2 id="home-recent" className="text-base font-semibold" style={{ color: "var(--text)" }}>{t("recent_saved")}</h2>
        <button type="button" onClick={onOpenLibrary} className="ms-auto text-[13px] font-semibold hover:underline" style={{ color: "var(--accent-bright)" }}>
          {t("recent_open_library")}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm" style={{ color: "var(--text-muted)" }}>{t("no_saved")}</p>
      ) : (
        <ul>
          {rows.map((e) => {
            const tone = FAMILY_TONE[e.family] ?? FAMILY_TONE.unknown;
            return (
              <li key={e.id} className="recent-row flex items-center gap-3.5 px-5 py-2.5 border-t" style={{ borderColor: "var(--border)" }}>
                <span
                  className="w-11 flex-shrink-0 text-center font-mono text-[10px] font-semibold py-1 rounded-md"
                  style={{ background: tone.bg, color: tone.fg }}
                >
                  {tone.tag}
                </span>
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm font-semibold truncate" style={{ color: "var(--text)" }} dir="auto">{e.name || e.type}</span>
                  <span className="text-xs font-mono truncate" style={{ color: "var(--text-muted)" }} dir="ltr">{previewOf(e)}</span>
                </span>
                {e.labels?.[0] && (
                  <span className="hidden md:inline text-xs px-2 py-0.5 rounded-md flex-shrink-0" style={{ background: "var(--bg-hover)", color: "var(--text-dim)" }} dir="auto">
                    {e.labels[0]}
                  </span>
                )}
                <span className="w-14 text-end text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                  {relativeTime(e.updated_at || e.created_at, lang)}
                </span>
                <button
                  type="button"
                  onClick={() => copy(e)}
                  aria-label={`${t("copy")} ${e.name || e.type}`}
                  title={t("copy")}
                  className="icon-btn w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0"
                  style={{ borderColor: "var(--border)", color: copiedId === e.id ? "var(--emerald)" : "var(--text-muted)" }}
                >
                  {copiedId === e.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
