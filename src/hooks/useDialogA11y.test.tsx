// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useDialogA11y } from "./useDialogA11y";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Dialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useDialogA11y(open, onClose);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Test">
      <button id="a">A</button>
      <button id="b">B</button>
    </div>
  );
}

// jsdom has no layout, so offsetParent is null; treat everything as visible.
Object.defineProperty(HTMLElement.prototype, "offsetParent", { get() { return this.parentNode; } });

async function mount(open: boolean, onClose: () => void) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const outside = document.createElement("button");
  outside.id = "outside";
  document.body.appendChild(outside);
  outside.focus();
  const root = createRoot(host);
  await act(async () => root.render(<Dialog open={open} onClose={onClose} />));
  await act(async () => new Promise<void>((r) => requestAnimationFrame(() => r())));
  return { root, outside };
}

const key = (k: string, shift = false) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true }));

describe("useDialogA11y", () => {
  it("moves focus in, traps Tab, closes on Escape and restores focus", async () => {
    const onClose = vi.fn();
    const { root, outside } = await mount(true, onClose);
    expect(document.activeElement?.id).toBe("a");

    (document.getElementById("b") as HTMLElement).focus();
    key("Tab");
    expect(document.activeElement?.id).toBe("a");
    key("Tab", true);
    expect(document.activeElement?.id).toBe("b");

    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => root.render(<Dialog open={false} onClose={onClose} />));
    expect(document.activeElement).toBe(outside);
    root.unmount();
  });
});
