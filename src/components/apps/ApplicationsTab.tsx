import React, { useEffect, useMemo, useState } from "react";
import {
  AppWindow, Check, ClipboardPaste, Copy, Edit3, Eye, EyeOff, FolderInput, KeyRound, Loader2, MoreHorizontal, Plus, Search, StickyNote, Terminal, Trash2, Unlink, X,
} from "lucide-react";
import { APP_NOTE_TYPE, DEFAULT_ENVS, appKeys, normalizeAppName, normalizeEnvName, sameName, summarizeApps, toDotenv } from "../../../shared/apps";
import type { Settings, VaultEntry } from "../../types";
import { getTranslation } from "../../utils/i18n";
import { copyTextToClipboard } from "../../lib/clipboard";
import { fill } from "../home/DashboardCards";
import { CursorMenu } from "../scratchpad/CursorMenu";
import { PasteEnvDialog } from "./PasteEnvDialog";
import { AddExistingDialog } from "./AddExistingDialog";
import { AppNotesPanel } from "./AppNotesPanel";
import { AppCommandsPanel } from "./AppCommandsPanel";
import { assignToApp, deleteEntries, hygieneBadge, patchEntry, renameApp, saveEntries, upsertAppKeys } from "./appsApi";
import type { TFn } from "./types";

interface Props {
  entries: VaultEntry[];
  settings: Settings | null;
  onFetchAll: () => Promise<void>;
  showConfirm: (title: string, message: string, onConfirm: () => void, confirmText?: string) => Promise<void>;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  /** Show one Scratchpad note (an application's note) in the Scratchpad. */
  onOpenNote: (noteId: string) => void;
}

type Section = "keys" | "notes" | "commands";

const chip = "px-2 py-0.5 rounded-full text-[10px] font-medium";
const iconBtn = "p-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors";
const softBtn = "h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all disabled:opacity-50";
const softStyle: React.CSSProperties = { background: "var(--bg-input)", color: "var(--text-dim)", border: "1px solid var(--border)" };

export function ApplicationsTab({ entries, settings, onFetchAll, showConfirm, showToast, onOpenNote }: Props) {
  const t: TFn = (key) => getTranslation(settings, key);
  const apps = useMemo(() => summarizeApps(entries), [entries]);
  const [selected, setSelected] = useState<string | null>(null);
  const [env, setEnv] = useState<string>(DEFAULT_ENVS[0]);
  const [extraEnvs, setExtraEnvs] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [addingEnv, setAddingEnv] = useState(false);
  const [envDraft, setEnvDraft] = useState("");
  const [dialog, setDialog] = useState<"paste" | "existing" | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [section, setSection] = useState<Section>("keys");
  const [noteCount, setNoteCount] = useState<number | null>(null);
  const q = query.trim().toLowerCase();
  const visibleApps = useMemo(() => {
    if (!q) return apps;
    return apps.filter(
      (a) => a.name.toLowerCase().includes(q) || entries.some((e) => sameName(e.app, a.name) && e.type !== APP_NOTE_TYPE && e.name.toLowerCase().includes(q))
    );
  }, [apps, entries, q]);

  // Keep a valid selection when apps appear, vanish or get renamed.
  useEffect(() => {
    if (selected && apps.some((a) => sameName(a.name, selected))) return;
    setSelected(apps[0]?.name ?? null);
  }, [apps, selected]);

  const current = apps.find((a) => sameName(a.name, selected ?? undefined)) ?? null;
  const envTabs = useMemo(() => {
    if (!current) return [] as string[];
    const names = current.envs.map((e) => e.name);
    for (const x of extraEnvs[current.name.toLowerCase()] ?? []) if (!names.some((n) => n.toLowerCase() === x.toLowerCase())) names.push(x);
    if (!names.length) names.push(DEFAULT_ENVS[0]);
    return names;
  }, [current, extraEnvs]);

  useEffect(() => {
    if (envTabs.length && !envTabs.some((e) => e.toLowerCase() === env.toLowerCase())) setEnv(envTabs[0]);
  }, [envTabs, env]);

  const keys = useMemo(() => {
    if (!current) return [];
    const list = appKeys(entries, current.name, env);
    if (!q || current.name.toLowerCase().includes(q)) return list;
    return list.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, current, env, q]);

  const commands = useMemo(() => (current ? entries.filter((e) => e.family === "command" && sameName(e.app, current.name)) : []), [entries, current]);
  useEffect(() => setNoteCount(null), [current?.name]);

  const refresh = async (msg?: string) => {
    await onFetchAll();
    if (msg) showToast(msg, "success");
  };
  const fail = (e: any) => showToast(e?.message || t("apps_error"), "error");

  const createApp = async () => {
    const name = normalizeAppName(newName);
    if (!name) return;
    if (apps.some((a) => sameName(a.name, name))) {
      setSelected(name);
    } else {
      try {
        await saveEntries([{ value: "", name: `${name} notes`, type: APP_NOTE_TYPE, family: "note", notes: "", app: name, raw_fragment: "", labels: [], type_aliases: [APP_NOTE_TYPE] }]);
        await refresh();
        setSelected(name);
      } catch (e) {
        return fail(e);
      }
    }
    setCreating(false);
    setNewName("");
  };

  const doRename = async () => {
    const to = normalizeAppName(renameValue);
    if (!current || !to || to === current.name) return setRenaming(false);
    try {
      await renameApp(current.name, to);
      setSelected(to);
      await refresh();
    } catch (e) {
      fail(e);
    }
    setRenaming(false);
  };

  const deleteApp = () => {
    if (!current) return;
    const ids = entries.filter((e) => sameName(e.app, current.name)).map((e) => e.id);
    showConfirm(fill(t("apps_delete_title"), { app: current.name }), fill(t("apps_delete_msg"), { n: current.count }), async () => {
      try {
        await deleteEntries(ids);
        await refresh();
      } catch (e) {
        fail(e);
      }
    }, t("apps_delete"));
  };

  const addEnv = () => {
    const name = normalizeEnvName(envDraft);
    if (current && name) {
      const k = current.name.toLowerCase();
      setExtraEnvs((p) => ({ ...p, [k]: [...(p[k] ?? []), name] }));
      setEnv(name);
    }
    setAddingEnv(false);
    setEnvDraft("");
  };

  const copyEnv = async () => {
    if (!current || !keys.length) return;
    const ok = await copyTextToClipboard(toDotenv(keys, `${current.name}${env ? ` · ${env}` : ""}`), { sensitive: true });
    showToast(ok ? fill(t("apps_copied_env"), { n: keys.length }) : t("apps_error"), ok ? "success" : "error");
  };

  if (!apps.length && !creating) {
    return (
      <div className="app-card p-10 flex flex-col items-center text-center gap-3">
        <div className="p-3 rounded-2xl" style={{ background: "var(--accent-bg)", color: "var(--accent-bright)" }}>
          <AppWindow className="w-6 h-6" />
        </div>
        <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>{t("apps_empty_title")}</h2>
        <p className="text-sm max-w-md" style={{ color: "var(--text-muted)" }}>{t("apps_empty_body")}</p>
        <button type="button" className="px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-1.5" style={{ background: "var(--accent)", color: "white" }} onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4" /> {t("apps_new")}
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(180px, 230px) minmax(0, 1fr)" }}>
      {/* ── Application list ── */}
      <aside className="app-card p-3 space-y-2 self-start" aria-label={t("tab_apps")}>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute top-1/2 -translate-y-1/2 start-2.5" style={{ color: "var(--text-muted)" }} />
          <input className="app-input w-full text-xs ps-8 pe-2 py-1.5" placeholder={t("apps_search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <nav className="space-y-0.5" aria-label={t("tab_apps")}>
          {visibleApps.map((a) => {
            const on = current && sameName(a.name, current.name);
            return (
              <button
                key={a.name}
                type="button"
                onClick={() => setSelected(a.name)}
                aria-current={on ? "page" : undefined}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-start transition-colors"
                style={{ background: on ? "var(--accent-bg)" : "transparent", color: on ? "var(--accent-bright)" : "var(--text-dim)", border: on ? "1px solid var(--border-glow)" : "1px solid transparent" }}
              >
                <AppWindow className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 truncate font-medium">{a.name}</span>
                <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>{a.count}</span>
              </button>
            );
          })}
          {q && !visibleApps.length && <p className="text-xs px-2 py-2" style={{ color: "var(--text-muted)" }}>{t("apps_no_match")}</p>}
        </nav>
        {creating ? (
          <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); createApp(); }}>
            <input autoFocus className="app-input w-full text-xs px-2 py-1.5" placeholder={t("apps_name_placeholder")} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} onKeyDown={(e) => e.key === "Escape" && setCreating(false)} />
            <div className="flex gap-1.5">
              <button type="submit" className="flex-1 px-2 py-1 rounded-md text-xs font-medium disabled:opacity-50" style={{ background: "var(--accent)", color: "white" }} disabled={!normalizeAppName(newName)}>{t("apps_create")}</button>
              <button type="button" className="px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }} onClick={() => setCreating(false)}>{t("apps_cancel")}</button>
            </div>
          </form>
        ) : (
          <button type="button" className={`${softBtn} w-full justify-center`} style={softStyle} onClick={() => setCreating(true)}>
            <Plus className="w-3.5 h-3.5" /> {t("apps_new")}
          </button>
        )}
      </aside>

      {/* ── Selected application ── */}
      {current ? (
        <section className="app-card p-4 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {renaming ? (
                <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); doRename(); }}>
                  <input autoFocus className="app-input text-sm px-2 py-1" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={200} aria-label={t("apps_rename_title")} onKeyDown={(e) => e.key === "Escape" && setRenaming(false)} />
                  <button type="submit" className={iconBtn} style={{ color: "var(--emerald)" }} aria-label={t("apps_save")}><Check className="w-4 h-4" /></button>
                  <button type="button" className={iconBtn} style={{ color: "var(--text-muted)" }} onClick={() => setRenaming(false)} aria-label={t("apps_cancel")}><X className="w-4 h-4" /></button>
                </form>
              ) : (
                <h2 className="text-base font-semibold truncate" style={{ color: "var(--text)" }}>{current.name}</h2>
              )}
              <span className={chip} style={{ background: "var(--bg-input)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>{fill(t("apps_count_keys"), { n: current.count })}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {section === "keys" && (
                <>
                  <button type="button" className={softBtn} style={softStyle} onClick={() => setDialog("paste")}><ClipboardPaste className="w-3.5 h-3.5" /> {t("apps_paste_env")}</button>
                  <button type="button" className={softBtn} style={softStyle} onClick={copyEnv} disabled={!keys.length}><Copy className="w-3.5 h-3.5" /> {t("apps_copy_env")}</button>
                </>
              )}
              <button type="button" className={iconBtn} style={{ color: "var(--text-muted)" }} aria-label="More" aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}>
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Keys | Notes | Commands */}
          <div className="flex items-center gap-4" role="tablist" aria-label={current.name} style={{ borderBottom: "1px solid var(--border)" }}>
            {([
              ["keys", <KeyRound key="i" className="w-3.5 h-3.5" />, t("apps_section_keys"), current.count],
              ["notes", <StickyNote key="i" className="w-3.5 h-3.5" />, t("apps_section_notes"), noteCount],
              ["commands", <Terminal key="i" className="w-3.5 h-3.5" />, t("apps_section_commands"), commands.length],
            ] as const).map(([id, icon, label, n]) => {
              const on = section === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSection(id)}
                  className="inline-flex items-center gap-1.5 px-1 pb-2 -mb-px text-xs font-semibold transition-colors"
                  style={{ color: on ? "var(--accent-bright)" : "var(--text-muted)", borderBottom: on ? "2px solid var(--accent-bright)" : "2px solid transparent" }}
                >
                  {icon} {label} {n != null && <span className="tabular-nums font-normal" style={{ color: "var(--text-muted)" }}>{n}</span>}
                </button>
              );
            })}
          </div>

          {section === "notes" && (
            <AppNotesPanel
              key={current.name}
              app={current.name}
              legacyText={(current.note as VaultEntry | undefined)?.notes}
              onLegacyMoved={async () => {
                const note = current.note as VaultEntry | undefined;
                if (note) await patchEntry(note.id, { notes: "", value: "" });
                await onFetchAll();
              }}
              onOpen={onOpenNote}
              onError={fail}
              onCount={setNoteCount}
              t={t}
            />
          )}
          {section === "commands" && <AppCommandsPanel app={current.name} commands={commands} t={t} onChanged={refresh} onError={fail} showConfirm={showConfirm} />}

          {section === "keys" && (<>
          {/* Environments */}
          <div className="flex flex-wrap items-center gap-1" role="tablist">
            {envTabs.map((e) => {
              const on = e.toLowerCase() === env.toLowerCase();
              const n = current.envs.find((x) => x.name.toLowerCase() === e.toLowerCase())?.count ?? 0;
              return (
                <button
                  key={e || "_none"}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setEnv(e)}
                  className="px-3 py-1 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: on ? "var(--bg-input)" : "transparent", color: on ? "var(--text)" : "var(--text-muted)", border: on ? "1px solid var(--border-glow)" : "1px solid transparent" }}
                >
                  {e || t("apps_env_none")} <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>{n}</span>
                </button>
              );
            })}
            {addingEnv ? (
              <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); addEnv(); }}>
                <input autoFocus className="app-input text-xs px-2 py-1 w-36" placeholder={t("apps_env_placeholder")} value={envDraft} onChange={(e) => setEnvDraft(e.target.value)} maxLength={64} onBlur={addEnv} onKeyDown={(e) => e.key === "Escape" && setAddingEnv(false)} />
              </form>
            ) : (
              <button type="button" className="px-2 py-1 rounded-lg text-xs inline-flex items-center gap-1" style={{ color: "var(--text-muted)" }} onClick={() => setAddingEnv(true)}>
                <Plus className="w-3 h-3" /> {t("apps_env_add")}
              </button>
            )}
          </div>

          {/* Keys */}
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <div className="grid gap-3 px-3 py-2 text-[10px] uppercase tracking-wide" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.5fr) auto", color: "var(--text-muted)", background: "var(--bg-input)" }}>
              <span>{t("apps_col_key")}</span>
              <span>{t("apps_col_value")}</span>
              <span />
            </div>
            {keys.map((k) => (
              <KeyRow key={k.id} entry={k} t={t} onChanged={refresh} onError={fail} showConfirm={showConfirm} />
            ))}
            {!keys.length && <p className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>{t("apps_no_keys_env")}</p>}
            <AddKeyRow app={current.name} env={env} t={t} onSaved={refresh} onError={fail} />
          </div>
          </>)}
        </section>
      ) : (
        <div />
      )}

      {menu && current && (
        <CursorMenu x={menu.x} y={menu.y} className="z-50 rounded-xl shadow-2xl p-1.5 w-60 text-xs" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-glow)" }}>
          <MenuButton icon={<FolderInput className="w-3.5 h-3.5" />} label={t("apps_add_existing")} onClick={() => { setMenu(null); setDialog("existing"); }} />
          <MenuButton icon={<Edit3 className="w-3.5 h-3.5" />} label={t("apps_rename")} onClick={() => { setMenu(null); setRenameValue(current.name); setRenaming(true); }} />
          <MenuButton icon={<Trash2 className="w-3.5 h-3.5" />} label={t("apps_delete")} danger onClick={() => { setMenu(null); deleteApp(); }} />
        </CursorMenu>
      )}
      {menu && <MenuDismiss onClose={() => setMenu(null)} />}

      {dialog === "paste" && current && (
        <PasteEnvDialog app={current.name} env={env} t={t} onClose={() => setDialog(null)} onSaved={async (msg) => { setDialog(null); await refresh(msg); }} />
      )}
      {dialog === "existing" && current && (
        <AddExistingDialog app={current.name} env={env} entries={entries} t={t} onClose={() => setDialog(null)} onDone={async (msg) => { setDialog(null); await refresh(msg); }} />
      )}
    </div>
  );
}

function MenuDismiss({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("click", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return null;
}

function MenuButton({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-start hover:bg-[var(--bg-hover)]" style={{ color: danger ? "var(--danger)" : "var(--text-dim)" }}>
      {icon}
      {label}
    </button>
  );
}

function KeyRow({ entry, t, onChanged, onError, showConfirm }: { entry: VaultEntry; t: TFn; onChanged: (msg?: string) => Promise<void>; onError: (e: any) => void; showConfirm: Props["showConfirm"] }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);
  const [value, setValue] = useState(entry.value);
  const badge = hygieneBadge(entry);

  const copy = async () => {
    setCopied(await copyTextToClipboard(entry.value, { sensitive: true }));
    setTimeout(() => setCopied(false), 1500);
  };
  const save = async () => {
    try {
      await patchEntry(entry.id, { name: name.trim() || entry.name, value });
      setEditing(false);
      await onChanged();
    } catch (e) {
      onError(e);
    }
  };
  const unlink = async () => {
    try {
      await assignToApp([entry.id], null);
      await onChanged();
    } catch (e) {
      onError(e);
    }
  };
  const remove = () =>
    showConfirm(fill(t("apps_delete_key_title"), { key: entry.name }), t("apps_delete_key_msg"), async () => {
      try {
        await deleteEntries([entry.id]);
        await onChanged();
      } catch (e) {
        onError(e);
      }
    }, t("apps_delete_key"));

  if (editing) {
    return (
      <form className="grid gap-3 px-3 py-2 items-center" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.5fr) auto", borderTop: "1px solid var(--border)" }} onSubmit={(e) => { e.preventDefault(); save(); }}>
        <input autoFocus className="app-input text-xs font-mono px-2 py-1" dir="ltr" value={name} onChange={(e) => setName(e.target.value)} aria-label={t("apps_col_key")} />
        <input className="app-input text-xs font-mono px-2 py-1" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("apps_col_value")} />
        <span className="flex">
          <button type="submit" className={iconBtn} style={{ color: "var(--emerald)" }} aria-label={t("apps_save")}><Check className="w-3.5 h-3.5" /></button>
          <button type="button" className={iconBtn} style={{ color: "var(--text-muted)" }} onClick={() => { setEditing(false); setName(entry.name); setValue(entry.value); }} aria-label={t("apps_cancel")}><X className="w-3.5 h-3.5" /></button>
        </span>
      </form>
    );
  }

  return (
    <div className="group grid gap-3 px-3 py-2 items-center hover:bg-[var(--bg-hover)] transition-colors" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.5fr) auto", borderTop: "1px solid var(--border)" }}>
      <span className="flex items-center gap-2 min-w-0">
        <KeyRound className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--amber)" }} />
        <span className="font-mono text-xs font-semibold truncate" style={{ color: "var(--text)" }} dir="ltr" title={entry.name}>{entry.name}</span>
      </span>
      <span className="flex items-center gap-2 min-w-0">
        <span
          className={`font-mono text-xs truncate ${revealed ? "select-text" : "tracking-widest select-none cursor-pointer"}`}
          style={{ color: revealed ? "var(--amber)" : "var(--text-muted)" }}
          dir="ltr"
          onClick={() => !revealed && setRevealed(true)}
          title={revealed ? undefined : t("apps_reveal")}
        >
          {revealed ? entry.value : "••••••••••••••••"}
        </span>
        {badge && (
          <span className={`${chip} shrink-0`} style={{ background: badge === "expired" ? "var(--danger-bg)" : "var(--amber-bg)", color: badge === "expired" ? "var(--danger)" : "var(--amber)" }}>
            {t(badge === "expired" ? "apps_expired" : badge === "expiring" ? "apps_expiring" : "apps_rotation_due")}
          </span>
        )}
      </span>
      <span className="flex items-center">
        <button type="button" className={iconBtn} style={{ color: revealed ? "var(--amber)" : "var(--text-muted)" }} onClick={() => setRevealed(!revealed)} aria-label={revealed ? t("apps_hide") : t("apps_reveal")} title={revealed ? t("apps_hide") : t("apps_reveal")}>
          {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
        <button type="button" className={iconBtn} style={{ color: copied ? "var(--emerald)" : "var(--text-muted)" }} onClick={copy} aria-label={t("apps_copy")} title={copied ? t("apps_copied") : t("apps_copy")}>
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        <span className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button type="button" className={iconBtn} style={{ color: "var(--text-muted)" }} onClick={() => setEditing(true)} aria-label={t("apps_edit")} title={t("apps_edit")}><Edit3 className="w-3.5 h-3.5" /></button>
          <button type="button" className={iconBtn} style={{ color: "var(--text-muted)" }} onClick={unlink} aria-label={t("apps_remove_from_app")} title={t("apps_remove_from_app")}><Unlink className="w-3.5 h-3.5" /></button>
          <button type="button" className={iconBtn} style={{ color: "var(--danger)" }} onClick={remove} aria-label={t("apps_delete_key")} title={t("apps_delete_key")}><Trash2 className="w-3.5 h-3.5" /></button>
        </span>
      </span>
    </div>
  );
}

function AddKeyRow({ app, env, t, onSaved, onError }: { app: string; env: string; t: TFn; onSaved: (msg?: string) => Promise<void>; onError: (e: any) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || !value) return;
    setBusy(true);
    try {
      await upsertAppKeys({ app, env: env || undefined, items: [{ name: name.trim(), value }] });
      setName("");
      setValue("");
      setOpen(false);
      await onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <button type="button" className="w-full flex items-center gap-1.5 px-3 py-2 text-xs hover:bg-[var(--bg-hover)]" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border)" }} onClick={() => setOpen(true)}>
        <Plus className="w-3.5 h-3.5" /> {t("apps_add_key")}
      </button>
    );
  }
  return (
    <form className="grid gap-3 px-3 py-2 items-center" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.5fr) auto", borderTop: "1px solid var(--border)" }} onSubmit={(e) => { e.preventDefault(); save(); }}>
      <input autoFocus className="app-input text-xs font-mono px-2 py-1" dir="ltr" placeholder="STRIPE_SECRET_KEY" value={name} onChange={(e) => setName(e.target.value)} aria-label={t("apps_col_key")} onKeyDown={(e) => e.key === "Escape" && setOpen(false)} />
      <input className="app-input text-xs font-mono px-2 py-1" dir="ltr" placeholder={t("apps_value_placeholder")} value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("apps_col_value")} onKeyDown={(e) => e.key === "Escape" && setOpen(false)} />
      <span className="flex">
        <button type="submit" className={iconBtn} style={{ color: "var(--emerald)" }} disabled={busy || !name.trim() || !value} aria-label={t("apps_save")}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
        <button type="button" className={iconBtn} style={{ color: "var(--text-muted)" }} onClick={() => setOpen(false)} aria-label={t("apps_cancel")}><X className="w-3.5 h-3.5" /></button>
      </span>
    </form>
  );
}
