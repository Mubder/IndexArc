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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh]">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">{t("fs_modal_title")}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t("fs_modal_subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-sm"
          >
            {t("fs_close_btn")}
          </button>
        </div>

        <div className="px-4 py-2 border-b border-slate-800 flex items-center gap-2">
          <button
            type="button"
            disabled={!fsParent && !!fsPath}
            onClick={() => onLoadFsDir(fsParent || "")}
            className="px-2 py-1 text-[11px] rounded-lg border border-slate-700 text-slate-300 disabled:opacity-40"
          >
            {t("fs_up_btn")}
          </button>
          <button
            type="button"
            onClick={() => onLoadFsDir("")}
            className="px-2 py-1 text-[11px] rounded-lg border border-slate-700 text-slate-300"
          >
            {t("fs_roots_btn")}
          </button>
          <div className="flex-1 font-mono text-[11px] text-slate-400 truncate" title={fsPath}>
            {fsPath || "(drives & home)"}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[40vh]">
          {fsLoading && (
            <p className="p-4 text-xs text-slate-500">{t("fs_loading")}</p>
          )}
          {fsError && (
            <p className="p-4 text-xs text-red-400">{fsError}</p>
          )}
          {!fsLoading &&
            !fsError &&
            fsEntries.map((ent) => (
              <button
                key={ent.path}
                type="button"
                onClick={() => onLoadFsDir(ent.path)}
                className="w-full text-left px-4 py-2.5 text-sm border-b border-slate-800/80 hover:bg-slate-800/60 flex items-center gap-2"
              >
                <Folder className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="truncate font-mono text-slate-200">{ent.name}</span>
              </button>
            ))}
          {!fsLoading && !fsError && !fsEntries.length && (
            <p className="p-4 text-xs text-slate-500">{t("fs_no_subfolders")}</p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-800 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-slate-400 hover:text-white"
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
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            {t("fs_use_path_btn")}
          </button>
          <button
            type="button"
            disabled={!fsPath || scanning}
            onClick={() => onFolderScan(fsPath)}
            className="px-4 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 font-medium disabled:opacity-40"
          >
            {scanning ? t("scanning_label") : t("fs_scan_folder_btn")}
          </button>
        </div>
      </div>
    </div>
  );
};
