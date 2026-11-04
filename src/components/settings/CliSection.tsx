import { useEffect, useState } from "react";
import { Copy, KeyRound, Terminal, Trash2 } from "lucide-react";
import type { TranslationDict } from "../../utils/i18n";

type T = (key: keyof TranslationDict) => string;

interface TokenRow {
  id: string;
  name: string;
  created_at: string;
  last_used_at?: string;
}

const field = { background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" } as const;

/** Settings → CLI access (R6.1): create, show once, and revoke CLI tokens. */
export function CliSection({ t, encrypted }: { t: T; encrypted: boolean }) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () =>
    fetch("/api/cli/tokens")
      .then((r) => (r.ok ? r.json() : { tokens: [] }))
      .then((d) => setTokens(d.tokens || []))
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setMsg("");
    const res = await fetch("/api/cli/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || "CLI", password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(data.error || t("failed_generic"));
    setFresh(data.token);
    setCopied(false);
    setName("");
    setPassword("");
    load();
  };

  const revoke = async (id: string) => {
    await fetch(`/api/cli/tokens/${encodeURIComponent(id)}/revoke`, { method: "POST" });
    load();
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
    } catch {
      /* ignore */
    }
  };

  return (
    <div id="cli-section" className="space-y-3 rounded-xl p-5 mt-4 scroll-mt-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
        <Terminal className="w-4 h-4" /> {t("cli_title")}
      </h2>
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>{t("cli_desc")}</p>
      <pre className="text-[11px] rounded-lg p-2 overflow-x-auto" style={{ ...field, fontFamily: "var(--font-mono)" }}>
{`indexarc login
indexarc get STRIPE_SECRET
indexarc run --label my-app -- npm start`}
      </pre>

      {fresh && (
        <div className="space-y-2 rounded-lg p-3" style={{ border: "1px solid var(--amber)" }}>
          <p className="text-[11px]" style={{ color: "var(--amber)" }}>{t("cli_token_once")}</p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 min-w-0 break-all text-[11px] rounded px-2 py-1" style={{ ...field, fontFamily: "var(--font-mono)" }}>{fresh}</code>
            <button type="button" onClick={copy} className="px-2 py-1 rounded-lg text-xs flex items-center gap-1" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
              <Copy className="w-3 h-3" /> {copied ? t("copied_bang") : t("copy")}
            </button>
          </div>
          <button type="button" onClick={() => setFresh(null)} className="text-[11px] underline" style={{ color: "var(--text-dim)" }}>
            {t("cli_done")}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("cli_token_name")} aria-label={t("cli_token_name")} maxLength={60} className="flex-1 min-w-[8rem] rounded-lg px-3 py-1.5 text-xs" style={field} />
        {encrypted && (
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("rk_password_prompt")} aria-label={t("rk_password_prompt")} className="flex-1 min-w-[8rem] rounded-lg px-3 py-1.5 text-xs" style={field} />
        )}
        <button type="button" onClick={create} className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1" style={{ background: "var(--accent)", color: "white" }}>
          <KeyRound className="w-3 h-3" /> {t("cli_create")}
        </button>
      </div>
      {msg && <p role="status" className="text-[11px]" style={{ color: "var(--danger)" }}>{msg}</p>}

      {tokens.length === 0 ? (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t("cli_none")}</p>
      ) : (
        <ul className="space-y-1">
          {tokens.map((tk) => (
            <li key={tk.id} className="flex items-center justify-between gap-2 text-xs rounded-lg px-2 py-1.5" style={{ border: "1px solid var(--border)" }}>
              <span className="truncate" style={{ color: "var(--text)" }}>{tk.name}</span>
              <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
                {tk.last_used_at ? `${t("cli_last_used")} ${new Date(tk.last_used_at).toLocaleString()}` : t("cli_never_used")}
              </span>
              <button type="button" onClick={() => revoke(tk.id)} aria-label={`${t("cli_revoke")} ${tk.name}`} title={t("cli_revoke")} className="p-1 rounded" style={{ color: "var(--danger)" }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{t("cli_note")}</p>
    </div>
  );
}
