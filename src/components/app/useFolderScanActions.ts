import type { FolderScanSession } from "../../types";
import { readJson } from "../../utils";
import { ScanCandidate } from "../../types";
import type { Dispatch, SetStateAction } from "react";
import type { TranslationDict } from "../../utils/i18n";
import { fill } from "../home/DashboardCards";
import type { Tab } from "../../types";

export interface UseFolderScanActionsArgs {
  fetchAll: () => Promise<void>;
  folderPath: string;
  folderUseAi: boolean;
  folderWatch: boolean;
  scanSession: FolderScanSession | null;
  setApplyingScan: Dispatch<SetStateAction<boolean>>;
  setFolderPath: Dispatch<SetStateAction<string>>;
  setFsBrowserOpen: Dispatch<SetStateAction<boolean>>;
  setFsEntries: Dispatch<SetStateAction<{ name: string; path: string; isDirectory: boolean; }[]>>;
  setFsError: Dispatch<SetStateAction<string>>;
  setFsLoading: Dispatch<SetStateAction<boolean>>;
  setFsParent: Dispatch<SetStateAction<string | null>>;
  setFsPath: Dispatch<SetStateAction<string>>;
  setScanSession: Dispatch<SetStateAction<FolderScanSession | null>>;
  setScanning: Dispatch<SetStateAction<boolean>>;
  setTab: Dispatch<SetStateAction<Tab>>;
  showConfirm: (title: string, message: string, onConfirm: () => void, confirmText?: string | undefined) => Promise<void>;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  t: (key: keyof TranslationDict) => string;
}

// Folder scan: the server folder browser, starting a scan, reviewing and applying the session.
// Moved verbatim from App.tsx (R3.4); App wires the inputs.
export function useFolderScanActions({ fetchAll, folderPath, folderUseAi, folderWatch, scanSession, setApplyingScan, setFolderPath, setFsBrowserOpen, setFsEntries, setFsError, setFsLoading, setFsParent, setFsPath, setScanSession, setScanning, setTab, showConfirm, showToast, t }: UseFolderScanActionsArgs) {
  const loadFsDir = async (dirPath: string) => {
    setFsLoading(true);
    setFsError("");
    try {
      const q = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
      const res = await fetch(`/api/fs/list${q}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || t("fs_cannot_list"));
      setFsPath(data.path || dirPath || "");
      setFsParent(data.parent ?? null);
      setFsEntries(data.entries || []);
    } catch (e: any) {
      setFsError(e.message || t("fs_list_failed"));
      setFsEntries([]);
    } finally {
      setFsLoading(false);
    }
  };

  const pickFolder = async () => {
    // Desktop Electron: OS native dialog → absolute path
    if (window.electronAPI?.selectFolder) {
      const folder = await window.electronAPI.selectFolder();
      if (folder) setFolderPath(folder);
      return;
    }
    // Web: browse the machine's disk via the local server (in place, no upload)
    setFsBrowserOpen(true);
    await loadFsDir("");
  };

  const handleFolderScan = async (pathOverride?: string) => {
    const target = (pathOverride ?? folderPath).trim();
    if (!target) return;
    setScanning(true);
    try {
      const res = await fetch("/api/folders/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: target,
          watch: folderWatch,
          use_ai: folderUseAi,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setFolderPath(target);
      setScanSession(data);
      setFsBrowserOpen(false);
      setTab("folders");
      fetchAll();
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setScanning(false);
    }
  };

  const patchScanCandidate = async (tempId: string, patch: Partial<ScanCandidate>) => {
    if (!scanSession) return;
    // optimistic local update
    setScanSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        candidates: prev.candidates.map((c) => {
          if (c.temp_id !== tempId) return c;
          const next = { ...c, ...patch };
          const secretLike = next.family === "secret" || next.family === "unknown";
          next.needs_type = secretLike && !String(next.type || "").trim();
          next.needs_name = secretLike && !String(next.name || "").trim();
          next.ready = !next.needs_type && !next.needs_name;
          return next;
        }),
      };
    });
    await fetch(`/api/folders/sessions/${scanSession.id}/candidates`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: [{ temp_id: tempId, ...patch }] }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }).catch(() => {
      // The optimistic UI now disagrees with the server — re-fetch the
      // session so the review shows what is actually persisted.
      fetchAll();
    });
  };

  const setAllDecisions = async (decision: "save" | "park" | "discard" | "pending") => {
    if (!scanSession) return;
    const candidatesPayload = scanSession.candidates.map((c) => ({
      temp_id: c.temp_id,
      decision,
    }));
    setScanSession({
      ...scanSession,
      candidates: scanSession.candidates.map((c) => ({ ...c, decision })),
    });
    await fetch(`/api/folders/sessions/${scanSession.id}/candidates`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: candidatesPayload }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }).catch(() => {
      fetchAll();
    });
  };

  const applyScanSession = async () => {
    if (!scanSession) return;
    setApplyingScan(true);
    try {
      const res = await fetch(`/api/folders/sessions/${scanSession.id}/apply`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("scan_apply_failed"));
      showToast(
        fill(t("scan_applied_summary"), { saved: data.saved_count, parked: data.parked_count, discarded: data.discarded_count }), "success"
      );
      setScanSession(null);
      fetchAll();
      setTab("home");
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setApplyingScan(false);
    }
  };

  const discardScanSession = async () => {
    if (!scanSession) return;
    showConfirm(t("confirm_discard_scan_title"), t("confirm_discard_scan_msg"), async () => {
      await fetch(`/api/folders/sessions/${scanSession.id}/discard`, { method: "POST" });
      setScanSession(null);
      fetchAll();
    }, t("discard_btn")).catch((e) => console.error("discard failed:", e?.message || e));
  };

  return { applyScanSession, discardScanSession, handleFolderScan, loadFsDir, patchScanCandidate, pickFolder, setAllDecisions };
}
