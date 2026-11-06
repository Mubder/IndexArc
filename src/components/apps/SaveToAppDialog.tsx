import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { DEFAULT_ENVS, envKey, normalizeAppName, normalizeEnvName, summarizeApps, type AppSummary } from "../../../shared/apps";
import { fill } from "../home/DashboardCards";
import { AppDialog, GHOST, PRIMARY, btnGhost, btnPrimary } from "./AppDialog";
import { UpsertPreview } from "./UpsertPreview";
import { upsertAppKeys, type UpsertItem, type UpsertReportItem } from "./appsApi";
import type { TFn } from "./types";

const NONE = "__none__";
const NEW = "__new__";

/**
 * Scratchpad → "Save secret to Vault": pick an application and environment
 * for the detected secrets. Each key shows whether it is new or updates one
 * already saved there. "No application" keeps the old Library-only save.
 */
export function SaveToAppDialog({
  items,
  t,
  onClose,
  onSaved,
  onSaveLibraryOnly,
}: {
  items: UpsertItem[];
  t: TFn;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onSaveLibraryOnly: () => Promise<void>;
}) {
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [appChoice, setAppChoice] = useState<string>(NEW);
  const [newApp, setNewApp] = useState("");
  const [envChoice, setEnvChoice] = useState<string>(DEFAULT_ENVS[0]);
  const [newEnv, setNewEnv] = useState("");
  const [plan, setPlan] = useState<UpsertReportItem[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(items.map((i) => envKey(i.name))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/entries")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (!live) return;
        const s = summarizeApps(Array.isArray(list) ? list : []);
        setApps(s);
        if (s.length) setAppChoice(s[0].name);
      })
      .catch(() => live && setApps([]));
    return () => {
      live = false;
    };
  }, []);

  const app = appChoice === NEW ? normalizeAppName(newApp) : appChoice === NONE ? undefined : appChoice;
  const env = envChoice === NEW ? normalizeEnvName(newEnv) : envChoice;
  const envOptions = useMemo(() => {
    const own = apps?.find((a) => a.name === appChoice)?.envs.map((e) => e.name).filter(Boolean) ?? [];
    return [...new Set([...DEFAULT_ENVS, ...own])];
  }, [apps, appChoice]);

  // Re-check new/update/unchanged whenever the destination changes.
  useEffect(() => {
    setPlan(null);
    if (!app) return;
    let live = true;
    const h = setTimeout(() => {
      upsertAppKeys({ app, env, items, dry_run: true })
        .then((r) => {
          if (!live) return;
          setPlan(r.items);
          setChecked(new Set(r.items.filter((i) => i.status !== "same").map((i) => i.key)));
        })
        .catch(() => live && setPlan(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [app, env, items]);

  const selected = items.filter((i) => checked.has(envKey(i.name)));
  const libraryOnly = appChoice === NONE;
  const count = libraryOnly ? items.length : plan ? plan.filter((p) => p.status !== "same" && checked.has(p.key)).length : selected.length;

  const save = async () => {
    setError("");
    if (libraryOnly) {
      setBusy(true);
      try {
        await onSaveLibraryOnly();
        onClose();
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!app) return setError(t("apps_name_required"));
    if (envChoice === NEW && !env) return setError(t("apps_name_required"));
    setBusy(true);
    try {
      const r = await upsertAppKeys({ app, env, items: selected });
      onSaved(`${app}${env ? ` · ${env}` : ""}: ${fill(t("apps_saved_result"), { created: r.created ?? 0, updated: r.updated ?? 0 })}`);
    } catch (e: any) {
      setError(e?.message || t("apps_error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppDialog
      title={fill(t("apps_save_secrets_title"), { n: items.length })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={GHOST} style={btnGhost} onClick={onClose}>{t("apps_cancel")}</button>
          <button type="button" className={PRIMARY} style={btnPrimary} disabled={busy || !count} onClick={save}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : fill(t("apps_save_n"), { n: count })}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs space-y-1" style={{ color: "var(--text-muted)" }}>
          <span>{t("apps_app_label")}</span>
          <select className="app-input w-full text-sm px-2 py-1.5" value={appChoice} onChange={(e) => setAppChoice(e.target.value)} disabled={!apps}>
            {(apps ?? []).map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
            <option value={NEW}>{t("apps_new_option")}</option>
            <option value={NONE}>{t("apps_none_library")}</option>
          </select>
        </label>
        <label className="text-xs space-y-1" style={{ color: "var(--text-muted)", opacity: libraryOnly ? 0.5 : 1 }}>
          <span>{t("apps_env_label")}</span>
          <select className="app-input w-full text-sm px-2 py-1.5" value={envChoice} onChange={(e) => setEnvChoice(e.target.value)} disabled={libraryOnly}>
            {envOptions.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
            <option value={NEW}>{t("apps_new_env_option")}</option>
          </select>
        </label>
        {appChoice === NEW && (
          <input data-autofocus className="app-input text-sm px-2 py-1.5" placeholder={t("apps_name_placeholder")} value={newApp} onChange={(e) => setNewApp(e.target.value)} maxLength={200} />
        )}
        {envChoice === NEW && !libraryOnly && (
          <input className="app-input text-sm px-2 py-1.5 col-start-2" placeholder={t("apps_env_placeholder")} value={newEnv} onChange={(e) => setNewEnv(e.target.value)} maxLength={64} />
        )}
      </div>

      {libraryOnly ? null : plan ? (
        <UpsertPreview
          items={plan}
          label={(s) => t(`apps_status_${s}` as any)}
          checked={checked}
          onToggle={(k) => setChecked((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
          })}
        />
      ) : app ? (
        <p className="text-xs flex items-center gap-2" style={{ color: "var(--text-muted)" }}><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("apps_checking")}</p>
      ) : (
        <UpsertPreview items={items.map((i) => ({ name: i.name, key: envKey(i.name), status: "new" as const }))} label={(s) => t(`apps_status_${s}` as any)} />
      )}
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </AppDialog>
  );
}
