import { describe, expect, it } from "vitest";
import { mergeLoadedTabs } from "./mergeLoadedTabs";
import type { ScratchTab } from "../types";

const tab = (id: string, title: string, content: string, extra: Partial<ScratchTab> = {}): ScratchTab => ({ id, title, content, ...extra });

describe("mergeLoadedTabs", () => {
  it("keeps text typed during the load", () => {
    const server = [tab("a", "Scratch 1", "<p>old</p>", { rev: 3 })];
    const held = [tab("a", "Scratch 1", "<p>new words</p>")];
    expect(mergeLoadedTabs(server, server, held)[0].content).toBe("<p>new words</p>");
    expect(mergeLoadedTabs(server, server, held)[0].rev).toBe(3);
  });

  it("keeps a rename the server has not stored yet", () => {
    const server = [tab("a", "Scratch 1", "<p>x</p>")];
    const local = [tab("a", "Deploy notes", "<p>x</p>", { title_custom: true })];
    const [m] = mergeLoadedTabs(server, local, []);
    expect(m.title).toBe("Deploy notes");
    expect(m.title_custom).toBe(true);
  });

  it("keeps a first-line name when the server is still Scratch", () => {
    const server = [tab("a", "Scratch 2", "<p>x</p>")];
    const local = [tab("a", "Sprint 42", "<p>x</p>")];
    expect(mergeLoadedTabs(server, local, [])[0].title).toBe("Sprint 42");
  });

  it("does not let an old local cache replace a server rename", () => {
    const server = [tab("a", "Kept on server", "<p>x</p>", { title_custom: true })];
    const local = [tab("a", "Scratch 1", "<p>x</p>")];
    expect(mergeLoadedTabs(server, local, [])[0].title).toBe("Kept on server");
  });
});
