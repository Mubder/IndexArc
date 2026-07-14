import React, { useState, useMemo } from "react";
import { Sparkles, Wand2, Copy, Check, RotateCcw } from "lucide-react";
import { VaultEntry, Settings, RewriteStyle } from "../types";
import { EntryCard } from "./EntryCard";
import { getTranslation } from "../utils/i18n";

interface AskTabProps {
  query: string;
  setQuery: (v: string) => void;
  onAsk: (e?: React.FormEvent) => Promise<void>;
  asking: boolean;
  askResults: { entry: VaultEntry; score: number; match_reason: string }[];
  answer?: string | null;
  providerUsed?: string;
  onOpenClarify: (entry: VaultEntry) => void;
  onDeleteEntry: (id: string) => Promise<void>;
  settings: Settings | null;
}

export const AskTab: React.FC<AskTabProps> = ({
  query,
  setQuery,
  onAsk,
  asking,
  askResults,
  answer,
  providerUsed,
  onOpenClarify,
  onDeleteEntry,
  settings,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  // Rewrite state
  const [mode, setMode] = useState<"search" | "rewrite">("search");
  const [rewriteText, setRewriteText] = useState("");
  const [rewriteStyle, setRewriteStyle] = useState<RewriteStyle>("professional");
  const [rewriteResult, setRewriteResult] = useState<string | null>(null);
  const [rewriteOriginal, setRewriteOriginal] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [copied, setCopied] = useState(false);

  const REWRITE_STYLES = useMemo(() => [
    { value: "human" as RewriteStyle, label: t("rewrite_style_human"), icon: "🗣", desc: t("rewrite_style_human_desc") },
    { value: "professional" as RewriteStyle, label: t("rewrite_style_professional"), icon: "💼", desc: t("rewrite_style_professional_desc") },
    { value: "technical" as RewriteStyle, label: t("rewrite_style_technical"), icon: "⚙️", desc: t("rewrite_style_technical_desc") },
    { value: "concise" as RewriteStyle, label: t("rewrite_style_concise"), icon: "✂️", desc: t("rewrite_style_concise_desc") },
    { value: "formal" as RewriteStyle, label: t("rewrite_style_formal"), icon: "📜", desc: t("rewrite_style_formal_desc") },
    { value: "casual" as RewriteStyle, label: t("rewrite_style_casual"), icon: "😊", desc: t("rewrite_style_casual_desc") },
  ], [settings]);

  const handleRewrite = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!rewriteText.trim() || rewriting) return;
    setRewriting(true);
    setRewriteResult(null);
    setRewriteOriginal(rewriteText);
    try {
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rewriteText, style: rewriteStyle }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRewriteResult(data.rewritten);
    } catch (err: any) {
      setRewriteResult(`Error: ${err.message}`);
    } finally {
      setRewriting(false);
    }
  };

  const copyRewrite = () => {
    if (rewriteResult) {
      navigator.clipboard?.writeText(rewriteResult).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex gap-1 p-1 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]" style={{ backdropFilter: "blur(10px)" }}>
        <button
          type="button"
          onClick={() => setMode("search")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${
            mode === "search"
              ? "bg-[var(--accent)] text-white shadow-md"
              : "text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          {t("ask_btn") || "Search Vault"}
        </button>
        <button
          type="button"
          onClick={() => setMode("rewrite")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${
            mode === "rewrite"
              ? "bg-[var(--accent)] text-white shadow-md"
              : "text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          <Wand2 className="w-4 h-4" />
          {t("rewrite_mode_btn")}
        </button>
      </div>

      {/* Search Mode */}
      {mode === "search" && (
        <>
          <form onSubmit={onAsk} className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-[var(--bg-input)] border border-[var(--border-input)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[var(--border-glow)] transition-colors"
              placeholder={t("ask_header_placeholder") || "Search tokens, keys, commands..."}
              style={{ color: "var(--text)" }}
            />
            <button
              type="submit"
              disabled={asking}
              className="px-5 py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, var(--accent), #1d4ed8)", boxShadow: "0 0 20px var(--accent-glow)" }}
            >
              {asking ? "..." : t("ask_btn") || "Search"}
            </button>
          </form>

          {answer && (
            <div className="rounded-2xl p-5 shadow-xl space-y-3 relative overflow-hidden" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              <div className="absolute top-0 right-0 p-4 opacity-[0.03] pointer-events-none">
                <Sparkles className="w-24 h-24" style={{ color: "var(--accent-bright)" }} />
              </div>
              <div className="flex items-center gap-2" style={{ color: "var(--accent-bright)" }}>
                <Sparkles className="w-4 h-4 animate-pulse" />
                <span className="text-xs font-semibold uppercase tracking-wider">{t("assistant_answer_title") || "Answer"}</span>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed select-text" style={{ color: "var(--text)" }}>
                {answer}
              </div>
              {providerUsed && (
                <div className="pt-2.5 border-t flex justify-between items-center text-[10px]" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                  <span>{t("bilingual_synth_footer") || "AI-generated"}</span>
                  <span className="font-mono text-[9px]">{providerUsed}</span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            {askResults.map((r) => (
              <EntryCard
                key={r.entry.id}
                entry={r.entry}
                score={r.score}
                reason={r.match_reason}
                onOpenClarify={onOpenClarify}
                onDeleteEntry={onDeleteEntry}
                settings={settings}
              />
            ))}
            {!askResults.length && !answer && (
              <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>{t("no_ask_results") || "No results yet. Try searching for a token, key, or command."}</p>
            )}
          </div>
        </>
      )}

      {/* Rewrite Mode */}
      {mode === "rewrite" && (
        <>
          {/* Style Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {t("rewrite_style_label")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {REWRITE_STYLES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setRewriteStyle(s.value)}
                  className="p-3 rounded-xl text-left transition-all border"
                  style={{
                    background: rewriteStyle === s.value ? "var(--accent-bg)" : "var(--bg-surface)",
                    borderColor: rewriteStyle === s.value ? "var(--border-glow)" : "var(--border)",
                    boxShadow: rewriteStyle === s.value ? "var(--shadow-glow)" : "none",
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base">{s.icon}</span>
                    <span className="text-xs font-semibold" style={{ color: rewriteStyle === s.value ? "var(--accent-bright)" : "var(--text)" }}>
                      {s.label}
                    </span>
                  </div>
                  <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <form onSubmit={handleRewrite} className="space-y-3">
            <textarea
              value={rewriteText}
              onChange={(e) => setRewriteText(e.target.value)}
              rows={6}
              className="w-full bg-[var(--bg-input)] border border-[var(--border-input)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[var(--border-glow)] transition-colors resize-none"
              placeholder={t("rewrite_placeholder")}
              style={{ color: "var(--text)", fontFamily: "var(--font-sans)" }}
            />
            <button
              type="submit"
              disabled={rewriting || !rewriteText.trim()}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, var(--accent), #1d4ed8)", boxShadow: "0 0 20px var(--accent-glow)" }}
            >
              <Wand2 className="w-4 h-4" />
              {rewriting ? t("rewriting_btn") : t("rewrite_btn")}
            </button>
          </form>

          {/* Result */}
          {rewriteResult && (
            <div className="rounded-2xl p-5 space-y-3 relative" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2" style={{ color: "var(--accent-bright)" }}>
                  <Wand2 className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wider">{t("assistant_answer_title") || "Rewritten Output"}</span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={copyRewrite}
                    className="p-2 rounded-lg transition-all"
                    style={{ background: copied ? "var(--emerald-bg)" : "var(--bg-hover)", color: copied ? "var(--emerald)" : "var(--text-dim)" }}
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => { setRewriteText(rewriteOriginal); setRewriteResult(null); }}
                    className="p-2 rounded-lg transition-all"
                    style={{ background: "var(--bg-hover)", color: "var(--text-dim)" }}
                    title="Show original"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div
                className="whitespace-pre-wrap text-sm leading-relaxed select-text p-4 rounded-xl"
                style={{ color: "var(--text)", background: "var(--bg-input)", border: "1px solid var(--border)" }}
              >
                {rewriteResult}
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => { navigator.clipboard?.writeText(rewriteResult); }}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all border"
                  style={{ borderColor: "var(--border)", color: "var(--text-dim)", background: "transparent" }}
                >
                  Copy Result
                </button>
                <button
                  onClick={handleRewrite}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold text-white transition-all"
                  style={{ background: "var(--accent)" }}
                >
                  Rewrite Again
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
