import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/** Below this many rows the list renders normally (no virtualization). */
export const VIRTUALIZE_FROM = 60;

/** Group items into rows of `cols` (grid mode). */
export function chunk<T>(items: T[], cols: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, cols)) out.push(items.slice(i, i + Math.max(1, cols)));
  return out;
}

/** Number of grid columns for the current width (matches `md:grid-cols-2`). */
function useColumns(): number {
  const query = "(min-width: 768px)";
  const [cols, setCols] = useState(() => (typeof window !== "undefined" && window.matchMedia?.(query).matches ? 2 : 1));
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setCols(mq.matches ? 2 : 1);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return cols;
}

/** Finds the nearest scrolling ancestor and the list offset inside it. */
function useScrollHost(hostRef: React.RefObject<HTMLElement | null>) {
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    let el = hostRef.current?.parentElement ?? null;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    setScrollEl(el ?? document.documentElement);
  }, [hostRef]);

  // Offset of the list inside the scroller (content above it: chips, search…).
  useLayoutEffect(() => {
    if (!scrollEl || !hostRef.current) return;
    const measure = () => {
      if (!hostRef.current) return;
      const top = hostRef.current.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
      setMargin(Math.round(top));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    if (scrollEl.firstElementChild) ro.observe(scrollEl.firstElementChild);
    return () => ro.disconnect();
  }, [scrollEl, hostRef]);

  return { scrollEl, margin };
}

/**
 * Renders only the rows near the viewport of the nearest scrolling ancestor
 * (the app's <main>). Row heights are measured, so cards of any size work.
 */
export function VirtualRows<T>({
  items,
  grid,
  estimate,
  getKey,
  renderItem,
  gap = 12,
}: {
  items: T[];
  grid: boolean;
  estimate: number;
  getKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  gap?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { scrollEl, margin } = useScrollHost(hostRef);
  const cols = useColumns();
  const rows = grid ? chunk(items, cols) : items.map((i) => [i]);

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => estimate + gap,
    overscan: 6,
    scrollMargin: margin,
    getItemKey: (i) => rows[i].map(getKey).join("|"),
  });

  return (
    <div ref={hostRef} data-virtual-list style={{ height: v.getTotalSize(), position: "relative" }}>
      {v.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={v.measureElement}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start - margin}px)`, paddingBottom: gap }}
        >
          {grid ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {rows[row.index].map((item) => (
                <React.Fragment key={getKey(item)}>{renderItem(item)}</React.Fragment>
              ))}
            </div>
          ) : (
            renderItem(rows[row.index][0])
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Table body that renders only visible rows, with spacer rows above and
 * below so the table keeps its native layout.
 */
export function VirtualTbody<T>({
  items,
  estimate,
  getKey,
  renderRow,
  colSpan,
}: {
  items: T[];
  estimate: number;
  getKey: (item: T) => string;
  renderRow: (item: T, measure: (el: Element | null) => void, index: number) => React.ReactNode;
  colSpan: number;
}) {
  const hostRef = useRef<HTMLTableSectionElement>(null);
  const { scrollEl, margin } = useScrollHost(hostRef);
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => estimate,
    overscan: 10,
    scrollMargin: margin,
    getItemKey: (i) => getKey(items[i]),
  });
  const vis = v.getVirtualItems();
  const top = vis.length ? vis[0].start - margin : 0;
  const bottom = vis.length ? v.getTotalSize() - (vis[vis.length - 1].end - margin) : 0;
  return (
    <tbody ref={hostRef} data-virtual-list>
      {top > 0 && (
        <tr aria-hidden="true">
          <td colSpan={colSpan} style={{ height: top, padding: 0, border: 0 }} />
        </tr>
      )}
      {vis.map((r) => (
        <React.Fragment key={r.key}>{renderRow(items[r.index], v.measureElement, r.index)}</React.Fragment>
      ))}
      {bottom > 0 && (
        <tr aria-hidden="true">
          <td colSpan={colSpan} style={{ height: bottom, padding: 0, border: 0 }} />
        </tr>
      )}
    </tbody>
  );
}
