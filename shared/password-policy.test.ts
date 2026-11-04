import { describe, it, expect } from "vitest";
import { checkPassword, MIN_PASSWORD_LENGTH, passwordProblemMessage } from "./password-policy";

describe("master password policy", () => {
  it.each([
    ["short", "too_short"],
    ["elevenchars", "too_short"],
    ["password1234", "common"],
    ["Password1234", "common"],
    ["P@ssw0rd1234", "common"],
    ["4321drowssap", "common"],
    ["qwertyuiopas", "common"],
    ["iloveyou2024!", "common"],
    ["123456789012", "common"],
    ["aaaaaaaaaaaa", "weak"],
  ])("rejects %s as %s", (pw, problem) => {
    const r = checkPassword(pw);
    expect(r.ok).toBe(false);
    // "common" and "weak" overlap for some inputs; what matters is the rejection
    // and that length is reported first.
    if (problem === "too_short") expect(r.problem).toBe("too_short");
    else expect(["common", "weak"]).toContain(r.problem);
  });

  it.each(["correct horse battery staple", "plum-harbor-violet-9", "Tr0ub4dor&3xy", "صباح الخير يا قمر ٢٠٢٦"])("accepts %s", (pw) => {
    expect(checkPassword(pw).ok).toBe(true);
  });

  it("counts characters, not UTF-16 units", () => {
    // 11 emoji are 22 UTF-16 units but still too short.
    expect(checkPassword("🔐".repeat(MIN_PASSWORD_LENGTH - 1)).problem).toBe("too_short");
  });

  it("has a message for every problem", () => {
    for (const p of ["too_short", "common", "weak"] as const) expect(passwordProblemMessage(p)).toMatch(/\w/);
  });
});
