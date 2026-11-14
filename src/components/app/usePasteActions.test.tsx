// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { usePasteActions } from "./usePasteActions";
import type { AnalyzeCandidate } from "../../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cand = {
  temp_id: "t1",
  value: "AIzaSyTEST_abcdefghijklmnopqrstuvwxyz12345",
  type: "google api key",
  name: "google api key",
  family: "secret",
} as AnalyzeCandidate;

afterEach(() => vi.unstubAllGlobals());

describe("Paste & Analyze save", () => {
  it("a double-click saves once and never reports its own save as a duplicate", async () => {
    let saved = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/entries/check-duplicate") {
        // The vault already holds the key once the first save landed.
        return new Response(JSON.stringify(saved ? { is_duplicate: true, existing_entry: { name: cand.name } } : { is_duplicate: false }));
      }
      saved++;
      return new Response(JSON.stringify({ entries: [{}] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const showConfirm = vi.fn(async () => {});

    let save!: (park: boolean) => Promise<void>;
    function Probe() {
      save = usePasteActions({
        candidates: [cand],
        fetchAll: async () => {},
        paste: "",
        pasteId: null,
        selected: { t1: true },
        setAnalyzing: () => {},
        setCandidates: () => {},
        setPaste: () => {},
        setPasteId: () => {},
        setProviderUsed: () => {},
        setSelected: () => {},
        setTab: () => {},
        showConfirm,
        showToast: () => {},
        t: (k) => k,
      }).handleSaveSelected;
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));

    await act(async () => {
      await Promise.all([save(false), save(false)]);
    });

    expect(saved).toBe(1);
    expect(showConfirm).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
