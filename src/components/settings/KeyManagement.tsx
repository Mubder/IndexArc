import { useEffect, useState } from "react";
import { KeyRound, LifeBuoy, Copy, Download, Check } from "lucide-react";
import type { TranslationDict } from "../../utils/i18n";
import { copyTextToClipboard } from "../../lib/clipboard";

type T = (key: keyof TranslationDict) => string;

const inputStyle = { background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" } as const;
const cardStyle = { background: "var(--bg-elevated, var(--bg-surface))", border: "1px solid var(--border)" } as const;

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data: any = {};
  try {
    data = await res.json();
  } catch {}
  return { ok: res.ok, data };
}

/** Change the master password (re-keys every file and record). */
export function ChangePasswordCard({ t, onToast }: { t: T; onToast?: (msg: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setDone(false);
    if (next.length < 8) return setError(t("pw_too_short"));
    if (next !== repeat) return setError(t("pw_mismatch"));
    setBusy(true);
    try {
      const { ok, data } = await postJson("/api/vault/change-password", { current_password: current, new_password: next });
      if (!ok) return setError(data.error || t("failed_generic"));
      setCurrent("");
      setNext("");
      setRepeat("");
      setDone(true);
      onToast?.(t("pw_changed"));
    } catch (err: any) {
      setError(err?.message || t("failed_generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-lg p-3 space-y-2" style={cardStyle} aria-labelledby="pw-change-title">
      <div id="pw-change-title" className="text-xs font-semibold flex items-center gap-1.5" style={{ color: "var(--text)" }}>
        <KeyRound className="w-3.5 h-3.5" /> {t("pw_change_title")}
      </div>
      <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>{t("pw_change_desc")}</p>
      <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder={t("pw_current")} aria-label={t("pw_current")} className="w-full rounded-lg px-3 py-1.5 text-xs" style={inputStyle} />
      <div className="flex gap-2">
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder={t("pw_new")} aria-label={t("pw_new")} className="flex-1 min-w-0 rounded-lg px-3 py-1.5 text-xs" style={inputStyle} />
        <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder={t("pw_confirm")} aria-label={t("pw_confirm")} className="flex-1 min-w-0 rounded-lg px-3 py-1.5 text-xs" style={inputStyle} />
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy || !current || !next || !repeat} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: "var(--accent)", color: "white" }}>
          {busy ? "…" : t("pw_change_btn")}
        </button>
        {done && <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--emerald)" }}><Check className="w-3.5 h-3.5" /> {t("pw_changed")}</span>}
      </div>
      {error && <p role="alert" className="text-[10px] font-mono" style={{ color: "var(--danger)" }}>{error}</p>}
    </form>
  );
}

interface RecoveryStatus {
  enabled: boolean;
  current: boolean;
  created_at: string | null;
}

/** Create / replace / remove the recovery key; shows a new code exactly once. */
export function RecoveryKeyCard({ t }: { t: T }) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/vault/recovery");
      if (res.ok) setStatus(await res.json());
    } catch {}
  };
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setError("");
    setBusy(true);
    try {
      const { ok, data } = await postJson("/api/vault/recovery", { password });
      if (!ok) return setError(data.error || t("failed_generic"));
      setPassword("");
      setCode(data.code);
      setStatus({ enabled: data.enabled, current: data.current, created_at: data.created_at });
    } catch (err: any) {
      setError(err?.message || t("failed_generic"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setError("");
    const { ok, data } = await postJson("/api/vault/recovery/remove", {});
    if (ok) setStatus(data);
    else setError(data.error || t("failed_generic"));
  };

  const copy = async () => {
    if (code && (await copyTextToClipboard(code, { sensitive: true }))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const download = () => {
    if (!code) return;
    const text = `${t("rk_file_header")}\n${new Date().toISOString()}\n\n${code}\n\n${t("rk_desc")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "IndexArc-recovery-key.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const badge = !status?.enabled
    ? { text: t("rk_status_none"), color: "var(--amber)" }
    : status.current
      ? { text: t("rk_status_ok"), color: "var(--emerald)" }
      : { text: t("rk_status_stale"), color: "var(--amber)" };

  return (
    <div className="rounded-lg p-3 space-y-2" style={cardStyle} aria-labelledby="rk-title">
      <div className="flex items-center justify-between gap-2">
        <div id="rk-title" className="text-xs font-semibold flex items-center gap-1.5" style={{ color: "var(--text)" }}>
          <LifeBuoy className="w-3.5 h-3.5" /> {t("rk_title")}
        </div>
        {status && <span className="text-[10px] font-semibold" style={{ color: badge.color }}>{badge.text}</span>}
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>{t("rk_desc")}</p>

      {code ? (
        <div className="space-y-2" role="region" aria-live="polite">
          <p className="text-[11px] font-semibold" style={{ color: "var(--amber)" }}>{t("rk_shown_once")}</p>
          <code data-testid="recovery-code" className="block rounded-lg px-3 py-2 text-[13px] leading-relaxed break-all select-all" style={{ ...inputStyle, letterSpacing: "0.04em" }}>
            {code}
          </code>
          <p className="text-[10px]" style={{ color: "var(--text-dim)" }}>{t("rk_replaced_note")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {t("rk_copy")}
            </button>
            <button type="button" onClick={download} className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
              <Download className="w-3.5 h-3.5" /> {t("rk_download")}
            </button>
            <button type="button" onClick={() => setCode(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--accent)", color: "white" }}>
              {t("rk_saved_confirm")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("rk_password_prompt")} aria-label={t("rk_password_prompt")} className="flex-1 min-w-[10rem] rounded-lg px-3 py-1.5 text-xs" style={inputStyle} />
          <button type="button" onClick={create} disabled={busy || !password} className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: "var(--accent)", color: "white" }}>
            {busy ? "…" : status?.enabled ? t("rk_replace_btn") : t("rk_create_btn")}
          </button>
          {status?.enabled && (
            <button type="button" onClick={remove} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid rgba(248, 113, 113, 0.2)" }}>
              {t("rk_remove_btn")}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-[10px] font-mono" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
