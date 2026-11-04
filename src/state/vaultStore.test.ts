import { describe, it, expect, vi } from "vitest";
import { createVaultStore, initialVaultState } from "./vaultStore";
import type { VaultEntry } from "../types";

const entry = { id: "e1", value: "sk-secret", name: "k" } as VaultEntry;

describe("vaultStore", () => {
  it("setters accept values and updaters, like useState", () => {
    const s = createVaultStore();
    s.set.paste("abc");
    s.set.entries((prev) => [...prev, entry]);
    expect(s.getState().paste).toBe("abc");
    expect(s.getState().entries).toEqual([entry]);
  });

  it("notifies only on real changes", () => {
    const s = createVaultStore();
    const l = vi.fn();
    s.subscribe(l);
    s.set.paste("");
    expect(l).not.toHaveBeenCalled();
    s.set.paste("x");
    expect(l).toHaveBeenCalledTimes(1);
  });

  it("purgeSecrets clears every field in one update", () => {
    const s = createVaultStore();
    s.set.entries([entry]);
    s.set.attention([entry]);
    s.set.paste("TOKEN=abc");
    s.set.pasteId("p1");
    s.set.candidates([{ id: "c", value: "v" } as never]);
    s.set.selected({ c: true });
    s.set.providerUsed("ollama");
    s.set.askResults([{ entry, score: 1, match_reason: "" }]);
    s.set.askAnswer("the key is sk-secret");
    s.set.askAnswerProvider("ollama");
    s.set.scanSession({ id: "s" } as never);
    const l = vi.fn();
    s.subscribe(l);
    s.purgeSecrets();
    expect(l).toHaveBeenCalledTimes(1);
    expect(s.getState()).toEqual(initialVaultState());
    expect(JSON.stringify(s.getState())).not.toContain("secret");
  });

  it("unsubscribe stops notifications", () => {
    const s = createVaultStore();
    const l = vi.fn();
    const off = s.subscribe(l);
    off();
    s.set.paste("y");
    expect(l).not.toHaveBeenCalled();
  });
});
