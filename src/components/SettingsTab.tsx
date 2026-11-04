import React from "react";
import { Settings, SystemStatus } from "../types";
import { getTranslation } from "../utils/i18n";
import { AppearanceSection } from "./settings/AppearanceSection";
import { PrivacySection } from "./settings/PrivacySection";
import { UpdatesSection } from "./settings/UpdatesSection";
import { ProviderPicker } from "./settings/ProviderPicker";
import { OllamaPanel } from "./settings/OllamaPanel";
import { GeminiPanel } from "./settings/GeminiPanel";
import { CloudKeyPanels } from "./settings/CloudKeyPanels";
import { LocalOpenAiPanel } from "./settings/LocalOpenAiPanel";
import { AdvancedAiSection } from "./settings/AdvancedAiSection";
import { SecuritySection } from "./settings/SecuritySection";
import { EmergencySection, type EmergencySnapshot } from "./settings/EmergencySection";
import { LogsSection } from "./settings/LogsSection";
import { PortingSection } from "./settings/PortingSection";
import { fill } from "./home/DashboardCards";

interface SettingsTabProps {
  settings: Settings;
  onPatchSettings: (patch: Partial<Settings>) => void;
  status: SystemStatus | null;
  onWarmOllama: () => Promise<void>;
  onSaveSettings: () => Promise<void>;
  vaultStatus: { is_locked: boolean; encryption_enabled: boolean } | null;
  onRefreshVaultStatus: () => void;
  logs: { time: string; type: string; message: string }[];
  onOpenHealth?: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  onPatchSettings,
  status,
  onWarmOllama,
  onSaveSettings,
  vaultStatus,
  onRefreshVaultStatus,
  logs,
  onOpenHealth,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const [secPassword, setSecPassword] = React.useState("");
  const [secError, setSecError] = React.useState("");

  const [snapshots, setSnapshots] = React.useState<EmergencySnapshot[]>([]);
  const [emgBusy, setEmgBusy] = React.useState(false);
  const [emgMsg, setEmgMsg] = React.useState("");
  const [confirmRestore, setConfirmRestore] = React.useState<string | null>(null);

  const loadSnapshots = React.useCallback(async () => {
    try {
      const res = await fetch("/api/emergency");
      const data = await res.json();
      setSnapshots(Array.isArray(data.snapshots) ? data.snapshots : []);
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const handleCreateSnapshot = async () => {
    setEmgBusy(true);
    setEmgMsg("");
    try {
      const res = await fetch("/api/emergency/create", { method: "POST" });
      if (!res.ok) {
        // A failed snapshot must never read as "nothing changed" — this UI
        // matters most during data-recovery scenarios.
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `${t("emergency_snapshot_failed")} (HTTP ${res.status})`);
      }
      const data = await res.json();
      setEmgMsg(
        data.ok
          ? t("emergency_created")
          : t("emergency_nochange")
      );
      await loadSnapshots();
    } catch (err: any) {
      setEmgMsg(err.message || t("failed_generic"));
    } finally {
      setEmgBusy(false);
    }
  };

  const handleRestoreSnapshot = async (name: string) => {
    setEmgBusy(true);
    setEmgMsg("");
    try {
      const res = await fetch("/api/emergency/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.ok) {
        const parts: string[] = [];
        if (typeof data.vault_total === "number") parts.push(`${data.vault_total} ${t("health_entries_unit")}`);
        if (typeof data.scratchpad_tabs === "number") parts.push(`${data.scratchpad_tabs} ${t("health_notes_unit")}`);
        setEmgMsg(
          parts.length
            ? fill(t("emergency_restored_counts"), { parts: parts.join(" · ") })
            : data.locked
              ? t("emergency_restored_locked")
              : t("emergency_restored")
        );
        onRefreshVaultStatus();
        await loadSnapshots();
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setEmgMsg(data.error || t("emergency_restore_failed"));
      }
    } catch (err: any) {
      setEmgMsg(err.message || t("failed_generic"));
    } finally {
      setEmgBusy(false);
      setConfirmRestore(null);
    }
  };

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const handleSetupPassword = async () => {
    if (!secPassword || secPassword.length < 8) {
      setSecError(t("sec_error_length"));
      return;
    }
    setSecError("");
    try {
      const res = await fetch("/api/vault/setup-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Explicit button click is the confirmation; the ceremony word passes
        // the server's anti-automation gate (see vault.ts setup-password).
        body: JSON.stringify({ password: secPassword, confirm_word: "ENCRYPT" }),
      });
      const data = await res.json();
      if (res.ok) {
        setSecPassword("");
        onRefreshVaultStatus();
      } else {
        setSecError(data.error || t("sec_setup_failed"));
      }
    } catch (err: any) {
      setSecError(err.message || t("request_failed"));
    }
  };

  const handleRemovePassword = async () => {
    if (!secPassword) return;
    setSecError("");
    try {
      const res = await fetch("/api/vault/remove-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: secPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setSecPassword("");
        onRefreshVaultStatus();
      } else {
        setSecError(data.error || t("sec_error_incorrect"));
      }
    } catch (err: any) {
      setSecError(err.message || t("request_failed"));
    }
  };

  return (
    <div className="rounded-2xl p-6 space-y-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <AppearanceSection onPatchSettings={onPatchSettings} settings={settings} t={t} />

      <PrivacySection onPatchSettings={onPatchSettings} settings={settings} t={t} />

      <UpdatesSection onPatchSettings={onPatchSettings} settings={settings} t={t} />

      <ProviderPicker onPatchSettings={onPatchSettings} settings={settings} status={status} t={t} />

      <OllamaPanel onPatchSettings={onPatchSettings} onWarmOllama={onWarmOllama} settings={settings} status={status} t={t} />

      <GeminiPanel onPatchSettings={onPatchSettings} settings={settings} t={t} />

      <CloudKeyPanels onPatchSettings={onPatchSettings} settings={settings} t={t} />

      <LocalOpenAiPanel onPatchSettings={onPatchSettings} settings={settings} t={t} />

      <AdvancedAiSection onPatchSettings={onPatchSettings} settings={settings} t={t} />

      <SecuritySection handleRemovePassword={handleRemovePassword} handleSetupPassword={handleSetupPassword} secError={secError} secPassword={secPassword} setSecPassword={setSecPassword} t={t} vaultStatus={vaultStatus} />

      <PortingSection t={t} encrypted={!!vaultStatus?.encryption_enabled} />

      <EmergencySection confirmRestore={confirmRestore} emgBusy={emgBusy} emgMsg={emgMsg} fmtDate={fmtDate} handleCreateSnapshot={handleCreateSnapshot} handleRestoreSnapshot={handleRestoreSnapshot} loadSnapshots={loadSnapshots} onOpenHealth={onOpenHealth} setConfirmRestore={setConfirmRestore} snapshots={snapshots} status={status} t={t} />

      <LogsSection logs={logs} t={t} />

      <button
        type="button"
        onClick={onSaveSettings}
        className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
        style={{ background: "var(--accent)", color: "white" }}
      >
        {t("save_settings_btn")}
      </button>
    </div>
  );
};
