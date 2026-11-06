import React, { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { normalizeAppName } from "../../../shared/apps";
import type { VaultEntry } from "../../types";
import { fill } from "../home/DashboardCards";
import { AppDialog, GHOST, PRIMARY, btnGhost, btnPrimary } from "./AppDialog";
import { assignToApp } from "./appsApi";
import type { TFn } from "./types";

/** Move secrets that belong to no application yet into this one. */
export function AddExistingDialog({ app, env, entries, t, onClose, onDone }: { app: string; env: string; entries: VaultEntry[]; t: TFn; onClose: () => void; onDone: (msg: string) => void }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loose = useMemo(
    () => entries.filter((e) => (e.family === "secret" || e.family === "unknown") && !normalizeAppName(e.app)),
    [entries]
  );
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return loose;
    return loose.filter((e) => `${e.name} ${e.type} ${(e.labels || []).join(" ")}`.toLowerCase().includes(s));
  }, [loose, q]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShown = shown.length > 0 && shown.every((e) => picked.has(e.id));

  const move = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await assignToApp([...picked], app, env || undefined);
      onDone(fill(t("apps_moved"), { n: r.moved }));
    } catch (e: any) {
      setError(e?.message || t("apps_error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppDialog
      title={fill(t("apps_existing_title"), { app: env ? `${app} · ${env}` : app })}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className={GHOST} style={btnGhost} onClick={onClose}>{t("apps_cancel")}</button>
          <button type="button" className={PRIMARY} style={btnPrimary} disabled={busy || !picked.size} onClick={move}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : fill(t("apps_move_n"), { n: picked.size })}
          </button>
        </>
      }
    >
      {loose.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>{t("apps_existing_none")}</p>
      ) : (
        <>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("apps_existing_hint")}</p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute top-1/2 -translate-y-1/2 start-2.5" style={{ color: "var(--text-muted)" }} />
              <input data-autofocus className="app-input w-full text-sm ps-8 pe-2 py-1.5" placeholder={t("apps_search")} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <label className="text-xs flex items-center gap-1.5 shrink-0" style={{ color: "var(--text-muted)" }}>
              <input
                type="checkbox"
                checked={allShown}
                onChange={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    for (const e of shown) allShown ? next.delete(e.id) : next.add(e.id);
                    return next;
                  })
                }
              />
              {t("apps_select_all")}
            </label>
          </div>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {shown.map((e, n) => (
              <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-[var(--bg-hover)]" style={{ borderTop: n ? "1px solid var(--border)" : undefined }}>
                <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
                <span className="font-semibold truncate" style={{ color: "var(--text)" }}>{e.name}</span>
                <span className="font-mono text-[10px] uppercase truncate" style={{ color: "var(--text-muted)" }}>{e.type}</span>
              </label>
            ))}
          </div>
        </>
      )}
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </AppDialog>
  );
}
