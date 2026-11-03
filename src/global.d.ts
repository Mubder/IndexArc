interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  isElectron: boolean;
  checkOllamaInstalled: () => Promise<boolean>;
  installOllama: () => Promise<{ ok: boolean; error?: string; path?: string | null }>;
  startOllama: () => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  getApiToken: () => Promise<string | null>;
  copyText: (text: string, clearAfterMs?: number) => Promise<boolean>;
  spellcheckWords: (words: string[]) => Promise<string[]>;
  spellcheckSuggest: (word: string) => Promise<string[]>;
  addCustomWord: (word: string) => Promise<void>;
  onFlushRequest: (cb: () => void) => void;
  flushComplete: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}


declare module "./shared/spellcheck.cjs" {
  const spellcheck: {
    findMisspelled: (words: string[], ar: unknown, en: unknown) => Promise<string[]>;
    checkArabicWord: (w: string, ar: unknown) => Promise<boolean>;
    checkEnglishWord: (w: string, en: unknown) => Promise<boolean>;
    sanitizeToken: (t: string) => string;
    isArabicToken: (t: string) => boolean;
    isLatinToken: (t: string) => boolean;
    stripArabicDiacritics: (s: string) => string;
  };
  export default spellcheck;
}

export {};
