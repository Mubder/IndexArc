import { useState, useRef, useCallback } from "react";

// Toast notifications: the visible list and showToast.
// Moved verbatim from App.tsx (R3.4); App wires the inputs.
export function useToasts() {
  const [toasts, setToasts] = useState<{ id: number; message: string; type: "success" | "error" | "info" }[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return { showToast, toasts };
}
