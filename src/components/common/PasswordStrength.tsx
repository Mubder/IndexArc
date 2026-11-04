import React, { useEffect, useState } from "react";
import type { PasswordCheck } from "../../../shared/password-policy";
import type { TranslationDict } from "../../utils/i18n";

type T = (key: keyof TranslationDict) => string;

/**
 * Checks a candidate master password against the shared policy (the same
 * one the server enforces). The policy module and its dictionary load on
 * first use, so screens without a new-password field never pay for them.
 * Returns null while loading or when the field is empty.
 */
export function usePasswordCheck(password: string): PasswordCheck | null {
  const [check, setCheck] = useState<PasswordCheck | null>(null);
  useEffect(() => {
    if (!password) {
      setCheck(null);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const { checkPassword } = await import("../../../shared/password-policy");
      if (live) setCheck(checkPassword(password));
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [password]);
  return check;
}

const COLORS = ["var(--danger)", "var(--danger)", "var(--amber, #f59e0b)", "var(--emerald)", "var(--emerald)"];

/** Strength meter (ASVS 2.1.8) plus the reason a password is refused. */
export function PasswordStrength({ check, t }: { check: PasswordCheck | null; t: T }) {
  if (!check) return null;
  const label = t(`pw_strength_${check.score}` as keyof TranslationDict);
  const problem =
    check.problem === "too_short" ? t("pw_too_short") : check.problem === "common" ? t("pw_problem_common") : check.problem === "weak" ? t("pw_problem_weak") : null;
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" role="meter" aria-label={t("pw_strength_label")} aria-valuemin={0} aria-valuemax={4} aria-valuenow={check.score} aria-valuetext={label}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-1 flex-1 rounded-full" style={{ background: i < Math.max(1, check.score) ? COLORS[check.score] : "var(--border)" }} />
          ))}
        </div>
        <span className="text-[11px] shrink-0" style={{ color: "var(--text-dim)" }}>
          {label}
        </span>
      </div>
      {problem && (
        <p className="text-[11px]" style={{ color: "var(--danger)" }}>
          {problem}
        </p>
      )}
    </div>
  );
}
