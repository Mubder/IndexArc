import { useEffect, useRef } from "react";

/**
 * Accessible modal behavior (R4): attach the returned ref to the dialog
 * panel (the element with role="dialog").
 * - On open, focus moves into the dialog (the first [data-autofocus]
 *   element, else the first focusable control, else the panel itself).
 * - Tab and Shift+Tab stay inside the dialog.
 * - Escape calls onClose, and only the top-most open dialog reacts.
 * - On close, focus returns to whatever had it before.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const stack: HTMLElement[] = [];

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getAttribute("aria-hidden") !== "true" && (el.offsetParent !== null || el === document.activeElement)
  );
}

export function useDialogA11y<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose?: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    stack.push(panel);

    if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
    const auto = panel.querySelector<HTMLElement>("[data-autofocus]");
    // Defer so children mounted in the same commit are focusable.
    const raf = requestAnimationFrame(() => {
      if (!panel.contains(document.activeElement)) (auto || focusableIn(panel)[0] || panel).focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== panel) return; // a nested dialog owns the keys
      if (e.key === "Escape" && onCloseRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusableIn(panel);
      if (!items.length) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey, true);
      const i = stack.lastIndexOf(panel);
      if (i >= 0) stack.splice(i, 1);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  return ref;
}
