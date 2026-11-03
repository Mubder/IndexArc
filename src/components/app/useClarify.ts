import { useState } from "react";
import { VaultEntry } from "../../types";

export interface UseClarifyArgs {
  fetchAll: () => Promise<void>;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
}

// The clarify dialog: what the user is clarifying and the submit that saves it.
// Moved verbatim from App.tsx (R3.4); App wires the inputs.
export function useClarify({ fetchAll, showToast }: UseClarifyArgs) {
  // clarify modal
  const [clarify, setClarify] = useState<VaultEntry | null>(null);
  const [clarifyType, setClarifyType] = useState("");
  const [clarifyName, setClarifyName] = useState("");
  const [clarifyValue, setClarifyValue] = useState("");
  const [clarifyFamily, setClarifyFamily] = useState<VaultEntry["family"]>("secret");

  const openClarify = (entry: VaultEntry) => {
    setClarify(entry);
    setClarifyType(entry.type === "unidentified" ? "" : entry.type);
    setClarifyName(entry.name === "unnamed" ? "" : entry.name);
    setClarifyValue("");
    setClarifyFamily(entry.family || "secret");
  };

  const submitClarify = async () => {
    if (!clarify) return;
    const secretLike = clarifyFamily === "secret" || clarifyFamily === "unknown";
    if (secretLike && !clarifyName.trim()) {
      showToast("Name is required / الاسم مطلوب", "error");
      return;
    }
    const value = clarifyValue.trim() || clarify.value;
    try {
      const res = await fetch(`/api/entries/${clarify.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: clarifyType.trim(),
          name: clarifyName.trim(),
          value,
          family: clarifyFamily,
        }),
      });
      if (res.ok) {
        setClarify(null);
        fetchAll();
      } else {
        // Surface the refusal — a silent no-op left the modal open with no
        // explanation (locked vault, validation error, network…).
        const err = await res.json().catch(() => null);
        showToast(err?.error || "Save failed / فشل الحفظ", "error");
      }
    } catch {
      showToast("Network error / خطأ في الاتصال", "error");
    }
  };

  return { clarify, clarifyFamily, clarifyName, clarifyType, clarifyValue, openClarify, setClarify, setClarifyFamily, setClarifyName, setClarifyType, setClarifyValue, submitClarify };
}
