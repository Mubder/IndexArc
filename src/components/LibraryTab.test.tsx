// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { LibraryTab } from "./LibraryTab";
import type { LibraryFilter, VaultEntry } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const key: VaultEntry = {
  id: "e1",
  value: "AIzaSyTEST_abcdefghijklmnopqrstuvwxyz12345",
  type: "google api key",
  name: "google api key",
  raw_fragment: "AIzaSyTEST_abcdefghijklmnopqrstuvwxyz12345",
  labels: [],
  type_aliases: ["google api key"],
  status: "saved",
  family: "secret",
  created_at: "2026-11-14T00:00:00.000Z",
  updated_at: "2026-11-14T00:00:00.000Z",
} as VaultEntry;

async function mount(filter: LibraryFilter, query: string, setLibraryFilter = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <LibraryTab
        entries={[key]}
        libraryFilter={filter}
        setLibraryFilter={setLibraryFilter}
        libraryQuery={query}
        setLibraryQuery={() => {}}
        onFetchAll={async () => {}}
        onOpenClarify={() => {}}
        onDeleteEntry={async () => {}}
        onBulkDeleteEntries={async () => {}}
        settings={null}
      />
    );
  });
  return { host, root, setLibraryFilter };
}

const offerButton = (host: HTMLElement) =>
  [...host.querySelectorAll("button")].find((b) => /found in All Items/.test(b.textContent || ""));

describe("LibraryTab search with a category selected", () => {
  it("offers matches hidden by the selected category instead of a dead end", async () => {
    // A Home card left "Commands" selected; the user searches for the key
    // they just saved.
    const { host, root, setLibraryFilter } = await mount("command", "google");
    expect(host.textContent).toContain("No entries match this filter");
    const btn = offerButton(host);
    expect(btn?.textContent).toContain("1 found in All Items");
    await act(async () => btn!.click());
    expect(setLibraryFilter).toHaveBeenCalledWith("all");
    act(() => root.unmount());
  });

  it("offers nothing when the search matches nothing anywhere", async () => {
    const { host, root } = await mount("command", "no-such-key");
    expect(host.textContent).toContain("No entries match this filter");
    expect(offerButton(host)).toBeUndefined();
    act(() => root.unmount());
  });
});
