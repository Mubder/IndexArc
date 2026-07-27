interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  isElectron: boolean;
  checkOllamaInstalled: () => Promise<boolean>;
  installOllama: () => Promise<{ ok: boolean; error?: string; path?: string | null }>;
  startOllama: () => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  spellcheckWords: (words: string[]) => Promise<string[]>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// Third-party file parser without bundled types
declare module "pdf-parse/lib/pdf-parse.js" {
  const pdfParse: (data: Buffer, options?: any) => Promise<{ text: string; [k: string]: any }>;
  export default pdfParse;
}

declare module "./shared/spellcheck.cjs" {
  const spellcheck: {
    findMisspelled: (words: string[], ar: unknown, en: unknown) => string[];
    checkArabicWord: (w: string, ar: unknown) => boolean;
    checkEnglishWord: (w: string, en: unknown) => boolean;
    sanitizeToken: (t: string) => string;
    isArabicToken: (t: string) => boolean;
    isLatinToken: (t: string) => boolean;
    stripArabicDiacritics: (s: string) => string;
  };
  export default spellcheck;
}

export {};
