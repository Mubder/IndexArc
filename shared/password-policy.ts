// Master-password policy (ASVS 2.1.1, 2.1.7, 2.1.8), shared by the server
// (which enforces it) and the UI (which shows the strength meter).
//
// - At least 12 characters. No composition rules (ASVS 2.1.9).
// - Not a common password: checked offline against zxcvbn's bundled list of
//   common passwords (including l33t and reversed forms). Nothing is sent
//   over the network.
// - Not trivially guessable: zxcvbn score of at least 2 of 4, which rejects
//   things like "aaaaaaaaaaaa" or "123456789012" that pass the length rule.
//
// Applies only when a password is set or changed. Existing vaults with a
// shorter password still unlock.

import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { adjacencyGraphs, dictionary } from "@zxcvbn-ts/language-common";

export const MIN_PASSWORD_LENGTH = 12;
export const MIN_SCORE = 2;

export type PasswordProblem = "too_short" | "common" | "weak";

export interface PasswordCheck {
  ok: boolean;
  /** 0 (worst) – 4 (best), zxcvbn's estimate. */
  score: 0 | 1 | 2 | 3 | 4;
  problem?: PasswordProblem;
  /** zxcvbn feedback keys (e.g. "dates", "repeated"); the UI translates or drops them. */
  warning: string | null;
  suggestions: string[];
}

const COMMON_WARNINGS = new Set(["topTen", "topHundred", "common", "similarToCommon"]);

let factory: ZxcvbnFactory | null = null;
function zxcvbn() {
  // Building the dictionaries takes a moment; do it once, on first use.
  factory ??= new ZxcvbnFactory({ dictionary, graphs: adjacencyGraphs, useLevenshteinDistance: true });
  return factory;
}

/** `userInputs`: words the password must not lean on (app name, account names…). */
export function checkPassword(password: string, userInputs: string[] = []): PasswordCheck {
  const pw = String(password ?? "");
  const r = zxcvbn().check(pw.slice(0, 256), ["indexarc", "vault", ...userInputs]);
  const base = { score: r.score, warning: r.feedback.warning, suggestions: r.feedback.suggestions };
  if ([...pw].length < MIN_PASSWORD_LENGTH) return { ok: false, problem: "too_short", ...base };
  // One common-password match covering the whole password (any case, l33t or
  // reversed form): "Password1234", "P@ssw0rd1234", "4321drowssap".
  const whole = r.sequence.length === 1 && (r.sequence[0] as { dictionaryName?: string }).dictionaryName === "passwords-common";
  // A common password with a few characters added ("iloveyou2024!") only
  // passes once it scores well on its own merits.
  const nearCommon = COMMON_WARNINGS.has(r.feedback.warning ?? "") && r.score < 3;
  if (whole || (nearCommon && r.score <= MIN_SCORE)) return { ok: false, problem: "common", ...base };
  if (r.score < MIN_SCORE) return { ok: false, problem: "weak", ...base };
  return { ok: true, ...base };
}

/** English message for API errors; the UI uses its own translated strings. */
export function passwordProblemMessage(p: PasswordProblem): string {
  switch (p) {
    case "too_short":
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
    case "common":
      return "That password is on a list of commonly used passwords. Choose another.";
    case "weak":
      return "That password is too easy to guess. Use a longer phrase or mix in unrelated words.";
  }
}
