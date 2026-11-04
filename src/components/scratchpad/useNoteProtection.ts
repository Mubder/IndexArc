import { useRef, useState, useEffect, useCallback } from "react";
import { setSyncedScratchpadTabs } from "../../scratchpadSaveQueue";
import type { Dispatch, SetStateAction } from "react";
import type { ScratchTab } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

export interface UseNoteProtectionArgs {
  activeId: string;
  setTabs: Dispatch<SetStateAction<ScratchTab[]>>;
  tabs: ScratchTab[];
  t: (key: keyof TranslationDict) => string;
}

// Pin and protect state for notes, including the unprotect confirm modal.
// Moved verbatim from ScratchpadTab (R3.4); the component wires the inputs.
export function useNoteProtection({ activeId, setTabs, tabs, t }: UseNoteProtectionArgs) {
  // Read the translator via a ref so memoized callbacks keep stable deps.
  const tRef = useRef(t);
  tRef.current = t;
  // Live set of protected tab ids (read inside callbacks without re-binding deps)
  const protectedIdsRef = useRef<Set<string>>(new Set());
  protectedIdsRef.current = new Set(tabs.filter((t) => (t as any).protected).map((t) => t.id));
  // Protect/Pin UI state
  const [protectModal, setProtectModal] = useState<{ mode: "on" | "off"; tabId: string } | null>(null);
  const [protectConfirmInput, setProtectConfirmInput] = useState("");
  const [protectError, setProtectError] = useState("");
  const [protectShowInput, setProtectShowInput] = useState(true);
  const protectInputRef = useRef<HTMLInputElement | null>(null);

  // Force focus into the confirm field when the unprotect modal opens.
  // `autoFocus` alone can lose to the button that opened the modal (Chromium
  // re-focuses the clicked button after the click completes), which made the
  // field look inert.
  useEffect(() => {
    if (!protectModal || protectModal.mode !== "off") return;
    const focus = () => {
      const el = protectInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    };
    focus();
    const t1 = setTimeout(focus, 0);
    const t2 = setTimeout(focus, 120);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [protectModal]);

  const togglePin = useCallback(async () => {
    if (!activeId) return;
    const wantPinned = !(tabs.find((x) => x.id === activeId) as any)?.pinned;
    try {
      const res = await fetch(`/api/scratchpad/tabs/${encodeURIComponent(activeId)}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: wantPinned }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.tab) {
          setTabs((prev) => prev.map((x) => (x.id === activeId ? { ...x, ...(data.tab as any) } : x)));
          setSyncedScratchpadTabs(tabs.map((x) => (x.id === activeId ? { ...(data.tab as any), title: x.title } : x)));
        }
      }
    } catch {}
  }, [activeId, tabs]);

  const submitProtect = useCallback(async () => {
    if (!protectModal) return;
    const wantProtected = protectModal.mode === "on";
    const body: any = wantProtected
      ? { protected: true }
      : { protected: false, confirm_word: protectConfirmInput.trim(), password: protectConfirmInput.trim() };
    try {
      const res = await fetch(`/api/scratchpad/tabs/${encodeURIComponent(protectModal.tabId)}/protect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTabs((prev) => prev.map((x) => (x.id === protectModal.tabId ? { ...x, ...(data.tab as any) } : x)));
        setProtectModal(null);
        setProtectConfirmInput("");
        setProtectError("");
      } else {
        setProtectError(data.error || tRef.current("protect_confirm_failed"));
      }
    } catch (e: any) {
      setProtectError(e?.message || tRef.current("request_failed"));
    }
  }, [protectModal, protectConfirmInput]);

  return { protectConfirmInput, protectError, protectInputRef, protectModal, protectShowInput, protectedIdsRef, setProtectConfirmInput, setProtectError, setProtectModal, setProtectShowInput, submitProtect, togglePin };
}
