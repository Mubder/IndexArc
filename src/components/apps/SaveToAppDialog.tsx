import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { DEFAULT_ENVS, envKey, normalizeAppName, normalizeEnvName, sameName, summarizeApps, type AppSummary } from "../../../shared/apps";
import { fill } from "../home/DashboardCards";
import { AppDialog, GHOST, PRIMARY, btnGhost, btnPrimary } from "./AppDialog";
import { UpsertPreview } from "./UpsertPreview";
import { saveEntries, upsertAppKeys, type UpsertItem, type UpsertReportItem } from "./appsApi";
import { commandCandidate } from "./AppCommandsPanel";

export interface CommandItem {
  name: string;
  command: string;
}
import type { TFn } from "./types";

const NONE = "__none__";
const NEW = "__new__";

/**
 * Scratchpad → "Save secret to Vault": pick an application and environment
 * for the detected secrets. Each key shows whether it is new or updates one
 * already saved there. "No application" keeps the old Library-only save.
 * Detected commands are saved to the application too (Commands section),
 * skipping any it already has.
 */
export function SaveToAppDialog({
  items,
  commands = [],
  defaultApp,
  t,
  onClose,
  onSaved,
  onSaveLibraryOnly,
}: {
  items: UpsertItem[];
  commands?: CommandItem[];
  /** The note's application, chosen up front. */
  defaultApp?: string;
  t: TFn;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onSaveLibraryOnly: () => Promise<void>;
}) {
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [existing, setExisting] = useState<any[]>([]);
  const [appChoice, setAppChoice] = useState<string>(NEW);
  const [newApp, setNewApp] = useState(defaultApp ?? "");
  const [cmdChecked, setCmdChecked] = useState<Set<number>>(() => new Set(commands.map((_, i) => i)));
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
        const all = Array.isArray(list) ? list : [];
        const s = summarizeApps(all);
        setApps(s);
        setExisting(all);
        const own = defaultApp ? s.find((a) => sameName(a.name, defaultApp)) : undefined;
        if (own) setAppChoice(own.name);
        else if (!defaultApp && s.length) setAppChoice(s[0].name);
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
    if (!items.length) {
      setPlan([]);
      return;
    }
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
  // A command the application already has is not saved twice.
  const cmdKnown = (c: CommandItem) => !!app && existing.some((e) => e.family === "command" && sameName(e.app, app) && (e.value || "").trim() === c.command.trim());
  const cmdToSave = libraryOnly ? [] : commands.filter((c, i) => cmdChecked.has(i) && !cmdKnown(c));
  const keyCount = libraryOnly ? items.length : plan ? plan.filter((p) => p.status !== "same" && checked.has(p.key)).length : selected.length;
  const count = keyCount + cmdToSave.length;

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
      const r = selected.length ? await upsertAppKeys({ app, env, items: selected }) : { created: 0, updated: 0 };
      if (cmdToSave.length) await saveEntries(cmdToSave.map((c) => commandCandidate(app, c.name, c.command)));
      const parts = [fill(t("apps_saved_result"), { created: r.created ?? 0, updated: r.updated ?? 0 })];
      if (cmdToSave.length) parts.push(fill(t("apps_saved_commands"), { n: cmdToSave.length }));
      onSaved(`${app}${env ? ` · ${env}` : ""}: ${parts.join(" · ")}`);
    } catch (e: any) {
      setError(e?.message || t("apps_error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppDialog
      title={items.length ? fill(t("apps_save_secrets_title"), { n: items.length }) : fill(t("apps_save_commands_title"), { n: commands.length })}
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
      {!libraryOnly && commands.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{t("apps_section_commands")}</p>
          <ul className="rounded-lg max-h-40 overflow-auto" style={{ border: "1px solid var(--border)" }}>
            {commands.map((c, i) => {
              const known = cmdKnown(c);
              return (
                <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-xs" style={{ borderTop: i ? "1px solid var(--border)" : undefined }}>
                  <input
                    type="checkbox"
                    checked={!known && cmdChecked.has(i)}
                    disabled={known}
                    aria-label={c.name}
                    onChange={() => setCmdChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })}
                  />
                  <code className="flex-1 min-w-0 truncate font-mono" dir="ltr" style={{ color: "var(--text-dim)" }} title={c.command}>{c.command}</code>
                  <span className="text-[10px] shrink-0" style={{ color: known ? "var(--text-muted)" : "var(--emerald)" }}>{t(known ? "apps_status_same" : "apps_status_new")}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </AppDialog>
  );
}
