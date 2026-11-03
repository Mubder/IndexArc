import { ClarifyModal } from "../ClarifyModal";
import { ConfirmModal } from "../ConfirmModal";
import type { Dispatch, SetStateAction } from "react";
import type { Settings, VaultEntry } from "../../types";

export interface DialogModalsProps {
  clarify: VaultEntry | null;
  clarifyFamily: "secret" | "command" | "note" | "unknown";
  clarifyName: string;
  clarifyType: string;
  clarifyValue: string;
  closeConfirm: () => void;
  confirmState: { open: boolean; title: string; message: string; onConfirm: () => void; onCancel?: (() => void) | undefined; confirmText?: string | undefined; } | null;
  setClarify: Dispatch<SetStateAction<VaultEntry | null>>;
  setClarifyFamily: Dispatch<SetStateAction<"secret" | "command" | "note" | "unknown">>;
  setClarifyName: Dispatch<SetStateAction<string>>;
  setClarifyType: Dispatch<SetStateAction<string>>;
  setClarifyValue: Dispatch<SetStateAction<string>>;
  settings: Settings | null;
  submitClarify: () => Promise<void>;
}

export function DialogModals({ clarify, clarifyFamily, clarifyName, clarifyType, clarifyValue, closeConfirm, confirmState, setClarify, setClarifyFamily, setClarifyName, setClarifyType, setClarifyValue, settings, submitClarify }: DialogModalsProps) {
  return (
    <>
      {/* Clarify modal */}
      {clarify && (
        <ClarifyModal
          isOpen={!!clarify}
          onClose={() => setClarify(null)}
          clarify={clarify}
          clarifyType={clarifyType}
          setClarifyType={setClarifyType}
          clarifyName={clarifyName}
          setClarifyName={setClarifyName}
          clarifyValue={clarifyValue}
          setClarifyValue={setClarifyValue}
          clarifyFamily={clarifyFamily}
          setClarifyFamily={setClarifyFamily}
          onSubmitClarify={submitClarify}
          settings={settings}
        />
      )}

      {/* Confirm modal */}
      {confirmState && (
        <ConfirmModal
          isOpen={confirmState.open}
          onClose={() => {
            confirmState.onCancel?.();
            closeConfirm();
          }}
          onConfirm={confirmState.onConfirm}
          title={confirmState.title}
          message={confirmState.message}
          confirmText={confirmState.confirmText}
        />
      )}
    </>
  );
}
