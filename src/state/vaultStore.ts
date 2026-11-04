import { useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AnalyzeCandidate, FolderScanSession, VaultEntry } from "../types";

/**
 * One store for the renderer's secret-bearing vault/session state.
 *
 * Everything here can hold a secret value (entries, pasted text, unsaved
 * candidates, ask answers, scan candidates). Keeping it in one place makes
 * the lock purge a single call (`purgeSecrets`) instead of a list of
 * setters that a new field could be forgotten from.
 */
export type AskResult = { entry: VaultEntry; score: number; match_reason: string };

export interface VaultState {
  entries: VaultEntry[];
  attention: VaultEntry[];
  paste: string;
  pasteId: string | null;
  candidates: AnalyzeCandidate[];
  selected: Record<string, boolean>;
  providerUsed: string;
  askResults: AskResult[];
  askAnswer: string | null;
  askAnswerProvider: string;
  scanSession: FolderScanSession | null;
}

export const initialVaultState = (): VaultState => ({
  entries: [],
  attention: [],
  paste: "",
  pasteId: null,
  candidates: [],
  selected: {},
  providerUsed: "",
  askResults: [],
  askAnswer: null,
  askAnswerProvider: "",
  scanSession: null,
});

type Listener = () => void;

export function createVaultStore(init: VaultState = initialVaultState()) {
  let state = init;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());

  const setters = {} as { [K in keyof VaultState]: Dispatch<SetStateAction<VaultState[K]>> };
  for (const key of Object.keys(init) as (keyof VaultState)[]) {
    // Same contract as a useState setter: a value or an updater function,
    // and a no-op (no re-render) when the value is unchanged.
    (setters as Record<string, unknown>)[key] = (next: unknown) => {
      const prev = state[key];
      const value = typeof next === "function" ? (next as (p: unknown) => unknown)(prev) : next;
      if (Object.is(value, prev)) return;
      state = { ...state, [key]: value };
      emit();
    };
  }

  return {
    getState: () => state,
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set: setters,
    /** Drop every secret-bearing field in one update. */
    purgeSecrets() {
      state = initialVaultState();
      emit();
    },
  };
}

export type VaultStore = ReturnType<typeof createVaultStore>;

/** The app's single instance. */
export const vaultStore = createVaultStore();

/** Subscribe a component to one slice of the store. */
export function useVault<T>(selector: (s: VaultState) => T, store: VaultStore = vaultStore): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
