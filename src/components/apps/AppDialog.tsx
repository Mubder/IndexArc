import React, { useId } from "react";
import { X } from "lucide-react";
import { useDialogA11y } from "../../hooks/useDialogA11y";

/** The modal shell the Applications dialogs share (same look as ConfirmModal). */
export function AppDialog({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useDialogA11y(true, onClose);
  const titleId = useId();
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`p-5 w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[85vh] flex flex-col gap-4 shadow-2xl`}
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "1rem" }}
        dir="auto"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 id={titleId} className="text-base font-semibold" style={{ color: "var(--text)" }}>{title}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-hover)]" style={{ color: "var(--text-muted)" }} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto space-y-3">{children}</div>
        {footer && <div className="flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export const btnPrimary: React.CSSProperties = { background: "var(--accent)", color: "white" };
export const btnGhost: React.CSSProperties = { color: "var(--text-muted)" };
export const PRIMARY = "px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed";
export const GHOST = "px-3 py-1.5 text-sm";
