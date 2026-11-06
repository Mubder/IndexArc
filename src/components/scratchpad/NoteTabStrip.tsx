import type { Dispatch, SetStateAction } from "react";
import type React from "react";
import type { ScratchTab } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import { Pencil, Archive, X, Plus } from "lucide-react";

export interface NoteTabStripProps {
  activeId: string;
  addTab: () => void;
  archiveTab: (id: string) => Promise<void>;
  closeTab: (id: string, skipConfirm?: boolean) => Promise<void>;
  commitRename: (id: string) => void;
  dragId: string | null;
  overId: string | null;
  renameId: string | null;
  renameInputRef: (el: HTMLInputElement | null) => void;
  renameValue: string;
  reorderTab: (fromId: string, toId: string) => void;
  setActiveId: Dispatch<SetStateAction<string>>;
  setDragId: Dispatch<SetStateAction<string | null>>;
  setOverId: Dispatch<SetStateAction<string | null>>;
  setRenameId: Dispatch<SetStateAction<string | null>>;
  setRenameValue: Dispatch<SetStateAction<string>>;
  startRename: (id: string) => void;
  t: (key: keyof TranslationDict) => string;
  tabs: ScratchTab[];
  /** The application selector, at the start of the strip. */
  filter?: React.ReactNode;
}

export function NoteTabStrip({ activeId, addTab, archiveTab, closeTab, commitRename, dragId, overId, renameId, renameInputRef, renameValue, reorderTab, setActiveId, setDragId, setOverId, setRenameId, setRenameValue, startRename, t, tabs, filter }: NoteTabStripProps) {
  return (
    <>
      {/* Internal tabs — unified pill strip */}
      <div className="scratchpad-tab-strip flex items-center gap-1.5 flex-wrap">
        {filter && (
          <>
            {filter}
            <span className="w-px h-5 mx-0.5 shrink-0" style={{ background: "var(--border)" }} />
          </>
        )}
        {[...tabs.filter((t) => !t.archived)].sort((a, b) => {
          const ap = (a as any).pinned ? 1 : 0;
          const bp = (b as any).pinned ? 1 : 0;
          if (ap !== bp) return bp - ap; // pinned first
          return ((b as any).pinned_at || 0) - ((a as any).pinned_at || 0);
        }).map((tab) => {
          const isActive = tab.id === activeId;
          const renaming = renameId === tab.id;
          const tabProtected = (tab as any).protected;
          const tabPinned = (tab as any).pinned;
          return (
            <div
              key={tab.id}
              draggable
              onClick={() => setActiveId(tab.id)}
              onDragStart={(e) => {
                setDragId(tab.id);
                e.dataTransfer.effectAllowed = "move";
                try { e.dataTransfer.setData("text/plain", tab.id); } catch {}
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overId !== tab.id) setOverId(tab.id);
              }}
              onDragLeave={() => {
                if (overId === tab.id) setOverId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = dragId ?? e.dataTransfer.getData("text/plain");
                if (fromId) reorderTab(fromId, tab.id);
                setDragId(null);
                setOverId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
className="scratchpad-tab group cursor-pointer"
               data-active={isActive}
               style={{
                 opacity: dragId === tab.id ? 0.5 : 1,
                 transform: overId === tab.id ? "translateY(-1px)" : undefined,
               }}
               title={t("scratchpad_drag_to_reorder")}
            >
              {renaming ? (
                <input
                  autoFocus
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(tab.id);
                    if (e.key === "Escape") { setRenameId(null); setRenameValue(""); }
                  }}
                  onBlur={() => commitRename(tab.id)}
                  className="bg-transparent outline-none text-xs w-full truncate"
                  style={{ color: "var(--text)" }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => { e.stopPropagation(); startRename(tab.id); }}
                  className="truncate flex-1 min-w-0 flex items-center gap-1"
                  title={tab.title}
                >
                  {tabPinned && <span title={t("pin_pinned" as any) || "Pinned"}>📌</span>}
                  {tabProtected && <span title={t("protect_protected" as any) || "Protected"}>🔒</span>}
                  <span className="truncate">{tab.title}</span>
                </span>
              )}
              {!tabProtected && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); startRename(tab.id); }}
                className="opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity flex-shrink-0"
                aria-label={t("scratchpad_rename")}
                title={t("scratchpad_rename")}
              >
                <Pencil className="w-3 h-3" />
              </button>
              )}
              {!tabProtected && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); archiveTab(tab.id); }}
                className="opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity flex-shrink-0"
                aria-label={t("scratchpad_archive")}
                title={t("scratchpad_archive")}
              >
                <Archive className="w-3 h-3" />
              </button>
              )}
              {!tabProtected && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity flex-shrink-0"
                aria-label={t("scratchpad_close_tab")}
                title={t("scratchpad_close_tab")}
              >
                <X className="w-3 h-3" />
              </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={addTab}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition-all flex-shrink-0"
          style={{ color: "var(--text-muted)", border: "1px dashed var(--border)" }}
          title={t("scratchpad_add")}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </>
  );
}
