import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { fill } from "../home/DashboardCards";
import { AppDialog, GHOST, PRIMARY, btnGhost, btnPrimary } from "./AppDialog";
import { UpsertPreview } from "./UpsertPreview";
import { upsertAppKeys, type UpsertResult } from "./appsApi";
import type { TFn } from "./types";

/** Paste a .env file into one application and environment: preview, then save. */
export function PasteEnvDialog({ app, env, t, onClose, onSaved }: { app: string; env: string; t: TFn; onClose: () => void; onSaved: (msg: string) => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<UpsertResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (dry: boolean) => {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await upsertAppKeys({ app, env: env || undefined, text, dry_run: dry });
      if (dry) setPreview(r);
      else onSaved(fill(t("apps_saved_result"), { created: r.created ?? 0, updated: r.updated ?? 0 }));
    } catch (e: any) {
      setError(e?.message || t("apps_error"));
    } finally {
      setBusy(false);
    }
  };

  const skipped = preview ? Object.values(preview.skipped).reduce((a, b) => a + b, 0) : 0;
  const changes = preview ? preview.items.filter((i) => i.status !== "same").length : 0;
  const title = fill(t("apps_paste_title"), { app: env ? `${app} · ${env}` : app });

  return (
    <AppDialog
      title={title}
      onClose={onClose}
      wide
      footer={
        preview ? (
          <>
            <button type="button" className={GHOST} style={btnGhost} onClick={() => setPreview(null)}>{t("apps_back")}</button>
            <button type="button" className={PRIMARY} style={btnPrimary} disabled={busy || !changes} onClick={() => run(false)}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : fill(t("apps_save_n"), { n: changes })}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={GHOST} style={btnGhost} onClick={onClose}>{t("apps_cancel")}</button>
            <button type="button" className={PRIMARY} style={btnPrimary} disabled={busy || !text.trim()} onClick={() => run(true)}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t("apps_preview")}
            </button>
          </>
        )
      }
    >
      {preview ? (
        <>
          {preview.items.length ? (
            <UpsertPreview items={preview.items} label={(s) => t(`apps_status_${s}` as any)} />
          ) : null}
          {!changes && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("apps_nothing_to_save")}</p>}
          {skipped > 0 && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{fill(t("apps_skipped_lines"), { n: skipped })}</p>}
        </>
      ) : (
        <>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("apps_paste_hint")}</p>
          <textarea
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            spellCheck={false}
            dir="ltr"
            className="app-input w-full font-mono text-xs p-3"
            placeholder={"STRIPE_SECRET_KEY=sk_live_…\nDATABASE_URL=postgres://…"}
          />
        </>
      )}
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </AppDialog>
  );
}
