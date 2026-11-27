// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { closeHistory } from "@tiptap/pm/history";

describe("undo steps", () => {
  it("undo removes the word typed after a sealed paste and leaves the paste", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit],
      content: "<p>keep</p>",
    });
    editor.chain().focus("end").insertContent(" PASTED").run();
    editor.view.dispatch(closeHistory(editor.view.state.tr));
    editor.chain().focus("end").insertContent(" word").run();
    editor.commands.undo();
    const text = editor.getText();
    expect(text).toContain("PASTED");
    expect(text).not.toContain("word");
    editor.destroy();
  });
});
