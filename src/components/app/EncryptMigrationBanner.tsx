import type { Tab } from "../../types";
import { ShieldAlert } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { TranslationDict } from "../../utils/i18n";

export interface EncryptMigrationBannerProps {
  encryptBannerDismissed: boolean;
  setEncryptBannerDismissed: Dispatch<SetStateAction<boolean>>;
  setTab: Dispatch<SetStateAction<Tab>>;
  t: (key: keyof TranslationDict) => string;
  vaultStatus: { is_locked: boolean; encryption_enabled: boolean; needs_setup?: boolean | undefined; migration_recommended?: boolean | undefined; } | null;
}

export function EncryptMigrationBanner({ encryptBannerDismissed, setEncryptBannerDismissed, setTab, t, vaultStatus }: EncryptMigrationBannerProps) {
  return (
    <>
      {/* Encryption migration banner: an existing vault that predates
          encrypted-by-default stays usable, but the recommendation recurs
          every session until acted on (dismissal is per-session only). */}
      {vaultStatus?.migration_recommended && !encryptBannerDismissed && (
        <div
          className="flex items-center gap-3 px-4 py-2.5 text-xs border-b"
          style={{ background: "var(--amber-bg)", borderColor: "rgba(251, 191, 36, 0.2)", color: "var(--amber)" }}
          role="alert"
        >
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span className="font-semibold">{t("sec_encrypt_banner_title")}</span>
          <span className="opacity-80 hidden sm:inline">{t("sec_encrypt_banner_text")}</span>
          <button
            onClick={() => {
              // Jump STRAIGHT to the Security & Encryption card — the button
              // previously only switched tabs, leaving users to find the
              // master-password UI (or mistake the egress toggles for it).
              // The Settings subtree is huge and mounts asynchronously, so a
              // single smooth scrollIntoView races layout and silently lands
              // nowhere; a few settled instant attempts always converge.
              setTab("settings");
              [0, 80, 250, 600].forEach((delay) =>
                setTimeout(() => {
                  document
                    .getElementById("security-section")
                    ?.scrollIntoView({ block: "start" });
                  // scrollIntoView scrolls EVERY scrollable ancestor —
                  // including this overflow-hidden shell (programmatically
                  // scrollable per spec), which drifts the whole app frame.
                  // Only main may scroll; pin the shell back every attempt.
                  const shell = document.querySelector("#root")?.firstElementChild;
                  if (shell) shell.scrollTop = 0;
                }, delay)
              );
            }}
            className="ml-auto shrink-0 font-semibold px-3 py-1 rounded-lg border cursor-pointer"
            style={{ borderColor: "rgba(251, 191, 36, 0.35)", background: "transparent", color: "var(--amber)" }}
          >
            {t("sec_encrypt_banner_btn")}
          </button>
          <button
            onClick={() => setEncryptBannerDismissed(true)}
            className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer px-1"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
