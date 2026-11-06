// An application's commands: vault entries of family "command" with this app.
import React, { useState } from "react";
import { Check, Copy, Edit3, Loader2, Plus, Terminal, Trash2, X } from "lucide-react";
import type { VaultEntry } from "../../types";
import { copyTextToClipboard } from "../../lib/clipboard";
import { fill } from "../home/DashboardCards";
import { deleteEntries, patchEntry, saveEntries } from "./appsApi";
import type { TFn } from "./types";

interface Props {
  app: string;
  commands: VaultEntry[];
  t: TFn;
  onChanged: (msg?: string) => Promise<void>;
  onError: (e: any) => void;
  showConfirm: (title: string, message: string, onConfirm: () => void, confirmText?: string) => Promise<void>;
}

const iconBtn = "p-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors";

/** The candidate that saves one command into an application. */
export function commandCandidate(app: string, name: string, command: string) {
  return { value: command, name: name || command.slice(0, 60), type: "shell command", family: "command", notes: "", app, raw_fragment: command, labels: [], type_aliases: ["shell command"] };
}

export function AppCommandsPanel({ app, commands, t, onChanged, onError, showConfirm }: Props) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      {commands.map((c, i) => (
        <CommandRow key={c.id} entry={c} first={i === 0} t={t} onChanged={onChanged} onError={onError} showConfirm={showConfirm} />
      ))}
      {!commands.length && !adding && <p className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{t("apps_no_commands")}</p>}
      {adding ? (
        <CommandForm
          t={t}
          border={commands.length > 0}
          onCancel={() => setAdding(false)}
          onSave={async (name, command) => {
            await saveEntries([commandCandidate(app, name, command)]);
            setAdding(false);
            await onChanged();
          }}
          onError={onError}
        />
      ) : (
        <button type="button" className="w-full flex items-center gap-1.5 px-3 py-2 text-xs hover:bg-[var(--bg-hover)]" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border)" }} onClick={() => setAdding(true)}>
          <Plus className="w-3.5 h-3.5" /> {t("apps_add_command")}
        </button>
      )}
    </div>
  );
}

function CommandRow({ entry, first, t, onChanged, onError, showConfirm }: { entry: VaultEntry; first: boolean; t: TFn; onChanged: Props["onChanged"]; onError: Props["onError"]; showConfirm: Props["showConfirm"] }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const border = first ? undefined : "1px solid var(--border)";
  if (editing) {
    return (
      <CommandForm
        t={t}
        border={!first}
        initialName={entry.name}
        initialCommand={entry.value}
        onCancel={() => setEditing(false)}
        onSave={async (name, command) => {
          await patchEntry(entry.id, { name: name || entry.name, value: command });
          setEditing(false);
          await onChanged();
        }}
        onError={onError}
      />
    );
  }
  const copy = async () => {
    setCopied(await copyTextToClipboard(entry.value));
    setTimeout(() => setCopied(false), 1500);
  };
  const remove = () =>
    showConfirm(fill(t("apps_delete_command_title"), { name: entry.name }), t("apps_delete_command_msg"), async () => {
      try {
        await deleteEntries([entry.id]);
        await onChanged();
      } catch (e) {
        onError(e);
      }
    }, t("apps_delete_key"));
  return (
    <div className="group px-3 py-2 space-y-1 hover:bg-[var(--bg-hover)] transition-colors" style={{ borderTop: border }}>
      <div className="flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--emerald)" }} />
        <span className="flex-1 min-w-0 text-xs font-semibold truncate" style={{ color: "var(--text)" }} dir="auto">{entry.name}</span>
        <span className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button type="button" className={iconBtn} style={{ color: "var(--text-muted)" }} onClick={() => setEditing(true)} aria-label={t("apps_edit")} title={t("apps_edit")}><Edit3 className="w-3.5 h-3.5" /></button>
          <button type="button" className={iconBtn} style={{ color: "var(--danger)" }} onClick={remove} aria-label={t("apps_delete_key")} title={t("apps_delete_key")}><Trash2 className="w-3.5 h-3.5" /></button>
        </span>
        <button type="button" className={iconBtn} style={{ color: copied ? "var(--emerald)" : "var(--text-muted)" }} onClick={copy} aria-label={t("apps_copy")} title={copied ? t("apps_copied") : t("apps_copy")}>
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-all rounded-md px-2 py-1.5" dir="ltr" style={{ background: "var(--bg-input)", color: "var(--text-dim)" }}>{entry.value}</pre>
    </div>
  );
}

function CommandForm({ t, border, initialName = "", initialCommand = "", onSave, onCancel, onError }: { t: TFn; border: boolean; initialName?: string; initialCommand?: string; onSave: (name: string, command: string) => Promise<void>; onCancel: () => void; onError: (e: any) => void }) {
  const [name, setName] = useState(initialName);
  const [command, setCommand] = useState(initialCommand);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!command.trim()) return;
    setBusy(true);
    try {
      await onSave(name.trim(), command.trim());
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="px-3 py-2 space-y-1.5" style={{ borderTop: border ? "1px solid var(--border)" : undefined }} onSubmit={(e) => { e.preventDefault(); save(); }} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <input autoFocus className="app-input w-full text-xs px-2 py-1" dir="auto" placeholder={t("apps_command_name_placeholder")} value={name} onChange={(e) => setName(e.target.value)} aria-label={t("apps_command_name")} />
      <textarea className="app-input w-full text-xs font-mono px-2 py-1 resize-y" dir="ltr" rows={2} placeholder="npm run deploy -- --prod" value={command} onChange={(e) => setCommand(e.target.value)} aria-label={t("apps_command")} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }} />
      <div className="flex justify-end gap-1">
        <button type="button" className="px-2 py-1 text-xs" style={{ color: "var(--text-muted)" }} onClick={onCancel}><X className="w-3.5 h-3.5 inline" /> {t("apps_cancel")}</button>
        <button type="submit" className="px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 disabled:opacity-50" style={{ background: "var(--accent)", color: "white" }} disabled={busy || !command.trim()}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {t("apps_save")}
        </button>
      </div>
    </form>
  );
}
