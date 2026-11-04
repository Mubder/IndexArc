import { useEffect, useState } from "react";
import { CalendarClock, RotateCw, Search } from "lucide-react";
import type { VaultEntry } from "../types";
import type { TranslationDict } from "../utils/i18n";

type T = (key: keyof TranslationDict) => string;

const field = { background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" } as const;

async function patchHygiene(id: string, body: unknown): Promise<VaultEntry> {
  const res = await fetch(`/api/entries/${encodeURIComponent(id)}/hygiene`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "failed");
  return data;
}

/** Expiry, rotation reminder and "where used" for one secret (R6.3). */
export function HygienePanel({ entry, t }: { entry: VaultEntry; t: T }) {
  const [expires, setExpires] = useState(entry.expires_at ? entry.expires_at.slice(0, 10) : "");
  const [rotate, setRotate] = useState(entry.rotate_every_days ? String(entry.rotate_every_days) : "");
  const [rotatedAt, setRotatedAt] = useState(entry.last_rotated_at || null);
  const [msg, setMsg] = useState("");
  const [usages, setUsages] = useState<{ usages: { file: string; line: number }[]; scanned_files: number; truncated: boolean; roots: number } | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setExpires(entry.expires_at ? entry.expires_at.slice(0, 10) : "");
    setRotate(entry.rotate_every_days ? String(entry.rotate_every_days) : "");
    setRotatedAt(entry.last_rotated_at || null);
    setUsages(null);
    setMsg("");
  }, [entry.id]);

  const save = async () => {
    setMsg("");
    try {
      await patchHygiene(entry.id, { expires_at: expires || null, rotate_every_days: rotate ? Number(rotate) : null });
      setMsg(t("hyg_saved"));
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const markRotated = async () => {
    try {
      const u = await patchHygiene(entry.id, { rotated: true });
      setRotatedAt(u.last_rotated_at || null);
      setMsg(t("hyg_marked_rotated"));
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const findUsages = async () => {
    setSearching(true);
    setMsg("");
    try {
      const res = await fetch(`/api/entries/${encodeURIComponent(entry.id)}/usages`);
      const data = await res.json();
      if (!res.ok) setMsg(data.error || "failed");
      else setUsages(data);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
      <div className="text-xs font-semibold flex items-center gap-1.5" style={{ color: "var(--text)" }}>
        <CalendarClock className="w-3.5 h-3.5" /> {t("hyg_title")}
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-[11px] space-y-1" style={{ color: "var(--text-dim)" }}>
          <span className="block">{t("hyg_expires")}</span>
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="rounded-lg px-2 py-1 text-xs" style={field} />
        </label>
        <label className="text-[11px] space-y-1" style={{ color: "var(--text-dim)" }}>
          <span className="block">{t("hyg_rotate_days")}</span>
          <input type="number" min={0} max={3650} value={rotate} onChange={(e) => setRotate(e.target.value)} placeholder="90" className="w-24 rounded-lg px-2 py-1 text-xs" style={field} />
        </label>
        <button type="button" onClick={save} className="px-3 py-1 rounded-lg text-xs font-medium" style={{ background: "var(--accent)", color: "white" }}>
          {t("hyg_save")}
        </button>
        <button type="button" onClick={markRotated} className="px-3 py-1 rounded-lg text-xs flex items-center gap-1" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
          <RotateCw className="w-3 h-3" /> {t("hyg_mark_rotated")}
        </button>
        <button type="button" onClick={findUsages} disabled={searching} className="px-3 py-1 rounded-lg text-xs flex items-center gap-1 disabled:opacity-50" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
          <Search className="w-3 h-3" /> {searching ? "…" : t("hyg_where_used")}
        </button>
      </div>
      {rotatedAt && (
        <p className="text-[10px]" style={{ color: "var(--text-dim)" }}>
          {t("hyg_last_rotated")}: {new Date(rotatedAt).toLocaleDateString()}
        </p>
      )}
      {usages && (
        <div className="text-[11px] space-y-1" style={{ color: "var(--text-dim)" }}>
          {usages.roots === 0 ? (
            <p>{t("hyg_no_folders")}</p>
          ) : usages.usages.length === 0 ? (
            <p>{t("hyg_not_found").replace("{n}", String(usages.scanned_files))}</p>
          ) : (
            <ul className="max-h-32 overflow-auto font-mono space-y-0.5">
              {usages.usages.map((u, i) => (
                <li key={i} className="break-all" style={{ color: "var(--text)" }}>
                  {u.file}:{u.line}
                </li>
              ))}
            </ul>
          )}
          {usages.truncated && <p>{t("hyg_truncated")}</p>}
        </div>
      )}
      {msg && <p className="text-[10px]" role="status" style={{ color: "var(--text-muted)" }}>{msg}</p>}
    </div>
  );
}
