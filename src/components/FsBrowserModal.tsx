import React from "react";
import { Folder } from "lucide-react";
import { Settings } from "../types";
import { getTranslation } from "../utils/i18n";

interface FsBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  fsPath: string;
  fsParent: string | null;
  fsEntries: { name: string; path: string; isDirectory: boolean }[];
  fsLoading: boolean;
  fsError: string;
  onLoadFsDir: (dirPath: string) => Promise<void>;
  onSelectFolder: (path: string) => void;
  onFolderScan: (path: string) => Promise<void>;
  scanning: boolean;
  settings: Settings | null;
}

export const FsBrowserModal: React.FC<FsBrowserModalProps> = ({
  isOpen,
  onClose,
  fsPath,
  fsParent,
  fsEntries,
  fsLoading,
  fsError,
  onLoadFsDir,
  onSelectFolder,
  onFolderScan,
  scanning,
  settings,
}) => {
  if (!isOpen) return null;

  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div
        className="w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh]"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "1rem" }}
      >
        <div className="px-5 py-4 flex items-center justify-between gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t("fs_modal_title")}</h3>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              {t("fs_modal_subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            {t("fs_close_btn")}
          </button>
        </div>

        <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
          <button
            type="button"
            disabled={!fsParent && !!fsPath}
            onClick={() => onLoadFsDir(fsParent || "")}
            className="px-2 py-1 text-[11px] rounded-lg disabled:opacity-40"
            style={{ border: "1px solid var(--border)", color: "var(--text-dim)" }}
          >
            {t("fs_up_btn")}
          </button>
          <button
            type="button"
            onClick={() => onLoadFsDir("")}
            className="px-2 py-1 text-[11px] rounded-lg"
            style={{ border: "1px solid var(--border)", color: "var(--text-dim)" }}
          >
            {t("fs_roots_btn")}
          </button>
          <div className="flex-1 text-[11px] truncate" style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }} title={fsPath}>
            {fsPath || "(drives & home)"}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[40vh]">
          {fsLoading && (
            <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>{t("fs_loading")}</p>
          )}
          {fsError && (
            <p className="p-4 text-xs" style={{ color: "var(--danger)" }}>{fsError}</p>
          )}
          {!fsLoading &&
            !fsError &&
            fsEntries.map((ent) => (
              <button
                key={ent.path}
                type="button"
                onClick={() => onLoadFsDir(ent.path)}
                className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition-colors"
                style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Folder className="w-4 h-4 shrink-0" style={{ color: "var(--cyan)" }} />
                <span className="truncate" style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{ent.name}</span>
              </button>
            ))}
          {!fsLoading && !fsError && !fsEntries.length && (
            <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>{t("fs_no_subfolders")}</p>
          )}
        </div>

        <div className="px-4 py-3 flex flex-wrap gap-2 justify-end" style={{ borderTop: "1px solid var(--border)" }}>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("identify_cancel_btn")}
          </button>
          <button
            type="button"
            disabled={!fsPath || scanning}
            onClick={() => {
              onSelectFolder(fsPath);
              onClose();
            }}
            className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-40"
            style={{ border: "1px solid var(--border)", color: "var(--text)" }}
          >
            {t("fs_use_path_btn")}
          </button>
          <button
            type="button"
            disabled={!fsPath || scanning}
            onClick={() => onFolderScan(fsPath)}
            className="px-4 py-1.5 text-sm rounded-lg font-medium disabled:opacity-40"
            style={{ background: "var(--accent)", color: "white" }}
          >
            {scanning ? t("scanning_label") : t("fs_scan_folder_btn")}
          </button>
        </div>
      </div>
    </div>
  );
};
