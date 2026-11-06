import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const MARGIN = 8;

/**
 * Where a menu of size (w, h) opened at the cursor (x, y) should go so it stays
 * inside a viewport of size (vw, vh): at the cursor, flipped to the other side
 * of it when it would overflow, then clamped to the viewport edges.
 */
export function placeMenu(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  let left = x + w + MARGIN > vw ? x - w : x;
  let top = y + h + MARGIN > vh ? y - h : y;
  left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
  top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
  return { left, top };
}

/**
 * A popup menu anchored at the mouse cursor. It is portalled to <body>, so a
 * transformed or backdrop-filtered ancestor cannot shift its `position: fixed`,
 * and it is measured after every size change (for example when suggestions
 * load) so it never runs off the window.
 */
export function CursorMenu({ x, y, className, style, children }: { x: number; y: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => setPos(placeMenu(x, y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight));
    place();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    ro?.observe(el);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [x, y]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={className}
      // Hidden until measured, so it never flashes at the wrong spot.
      style={{ ...style, position: "fixed", left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? "visible" : "hidden" }}
    >
      {children}
    </div>,
    document.body
  );
}
