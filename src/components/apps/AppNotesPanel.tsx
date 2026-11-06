// An application's notes: Scratchpad notes linked to it (tab.app). Anything
// can go in them: commands, steps, explanations, keys. The text is edited in
// the Scratchpad; here it is read, copied and opened.
import React, { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Plus, StickyNote, Unlink } from "lucide-react";
import { sameName } from "../../../shared/apps";
import { copyTextToClipboard } from "../../lib/clipboard";
import { htmlToPlainText } from "../../lib/noteHtml";
import { fill } from "../home/DashboardCards";
import { createNote, listNotes, setNoteApp, textToNoteHtml, type NoteSummary } from "./appsApi";
import type { TFn } from "./types";

interface Props {
  app: string;
  /** Text of the application's old single note box, moved into an "Overview" note once. */
  legacyText?: string;
  onLegacyMoved: () => Promise<void>;
  onOpen: (noteId: string) => void;
  onError: (e: any) => void;
  onCount?: (n: number) => void;
  t: TFn;
}

const iconBtn = "p-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors";
/** Applications whose old note text is being moved, so it is moved once. */
const migrating = new Set<string>();

export function AppNotesPanel({ app, legacyText, onLegacyMoved, onOpen, onError, onCount, t }: Props) {
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      let all = await listNotes();
      // The old notes box held plain text on the application record; it
      // becomes the application's first note.
      const key = app.toLowerCase();
      if (legacyText?.trim() && !migrating.has(key)) {
        migrating.add(key);
        await createNote(app, t("apps_overview"), textToNoteHtml(legacyText));
        await onLegacyMoved();
        all = await listNotes();
      }
      const mine = all.filter((n) => sameName(n.app, app));
      setNotes(mine);
      onCount?.(mine.length);
    } catch (e) {
      setNotes([]);
      onError(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, legacyText]);

  useEffect(() => {
    setNotes(null);
    load();
    const again = () => document.visibilityState === "visible" && load();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [load]);

  const copy = async (n: NoteSummary) => {
    const ok = await copyTextToClipboard(htmlToPlainText(n.content || ""), { sensitive: true });
    if (ok) {
      setCopied(n.id);
      setTimeout(() => setCopied((c) => (c === n.id ? null : c)), 1500);
    }
  };

  const newNote = async () => {
    setBusy(true);
    try {
      const id = await createNote(app, fill(t("apps_note_default_title"), { app }));
      onOpen(id);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (n: NoteSummary) => {
    try {
      await setNoteApp(n.id, null);
      await load();
    } catch (e) {
      onError(e);
    }
  };

  if (!notes) {
    return (
      <div className="flex items-center gap-2 px-3 py-6 text-xs" style={{ color: "var(--text-muted)" }}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("apps_loading")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {notes.map((n) => {
        const text = htmlToPlainText(n.content || "").trim();
        return (
          <article key={n.id} className="group rounded-xl p-3 space-y-1.5" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
            <header className="flex items-center gap-2">
              <StickyNote className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent-bright)" }} />
              <button type="button" className="flex-1 min-w-0 text-start text-xs font-semibold truncate hover:underline" style={{ color: "var(--text)" }} onClick={() => onOpen(n.id)} title={t("apps_open_in_scratchpad")}>
                {n.title || t("apps_untitled_note")}
              </button>
              {n.updated_at && <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>{new Date(n.updated_at).toLocaleDateString()}</span>}
              <button type="button" className={iconBtn} style={{ color: copied === n.id ? "var(--emerald)" : "var(--text-muted)" }} onClick={() => copy(n)} aria-label={t("apps_copy_note")} title={copied === n.id ? t("apps_copied") : t("apps_copy_note")} disabled={!text}>
                {copied === n.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button type="button" className={iconBtn} style={{ color: "var(--text-muted)" }} onClick={() => onOpen(n.id)} aria-label={t("apps_open_in_scratchpad")} title={t("apps_open_in_scratchpad")}>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button type="button" className={`${iconBtn} opacity-0 group-hover:opacity-100 focus:opacity-100`} style={{ color: "var(--text-muted)" }} onClick={() => unlink(n)} aria-label={t("apps_unlink_note")} title={t("apps_unlink_note")}>
                <Unlink className="w-3.5 h-3.5" />
              </button>
            </header>
            <p className="text-xs whitespace-pre-wrap line-clamp-4" dir="auto" style={{ color: text ? "var(--text-dim)" : "var(--text-muted)" }}>
              {text || t("apps_note_empty")}
            </p>
          </article>
        );
      })}
      {!notes.length && <p className="px-1 py-2 text-xs" style={{ color: "var(--text-muted)" }}>{t("apps_no_notes")}</p>}
      <button type="button" className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs hover:bg-[var(--bg-hover)] disabled:opacity-50" style={{ color: "var(--text-muted)", border: "1px dashed var(--border)" }} onClick={newNote} disabled={busy}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {t("apps_new_note")}
      </button>
    </div>
  );
}
