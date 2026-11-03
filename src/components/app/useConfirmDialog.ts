import { useState, useCallback } from "react";

// The app-wide confirm dialog: state plus a promise-returning showConfirm.
// Moved verbatim from App.tsx (R3.4); App wires the inputs.
export function useConfirmDialog() {
  // confirm modal
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void; onCancel?: () => void; confirmText?: string } | null>(null);
  const showConfirm = useCallback((title: string, message: string, onConfirm: () => void, confirmText?: string): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      setConfirmState({
        open: true,
        title,
        message,
        confirmText,
        onConfirm: async () => {
          try {
            await onConfirm();
            resolve();
          } catch (e) {
            reject(e);
          }
          setConfirmState(null);
        },
        onCancel: () => {
          // Cancelling is not an error: resolve so an uncaught rejection can
          // never blank the app via the error boundary.
          resolve();
          setConfirmState(null);
        },
      });
    });
  }, []);
  const closeConfirm = useCallback(() => setConfirmState(null), []);

  return { closeConfirm, confirmState, showConfirm };
}
