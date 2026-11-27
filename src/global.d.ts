interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  isElectron: boolean;
  checkOllamaInstalled: () => Promise<boolean>;
  installOllama: () => Promise<{ ok: boolean; error?: string; path?: string | null }>;
  startOllama: () => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  getApiToken: () => Promise<string | null>;
  copyText: (text: string, clearAfterMs?: number, html?: string) => Promise<boolean>;
  readDocFile?: (filePath: string) => Promise<DocFilePayload | null>;
  pickDocFiles?: () => Promise<string[]>;
  writeDocFile?: (filePath: string, text: string) => Promise<{ ok: boolean; reason?: string }>;
  writeDocFileSync?: (filePath: string, text: string) => boolean;
  onDocsOpen?: (cb: (paths: string[]) => void) => void;
  takePendingDocs?: () => Promise<string[]>;
  encryptText?: (text: string) => Promise<string | null>;
  decryptText?: (encoded: string) => Promise<string | null>;
  listDocBackups?: (filePath: string) => Promise<{ ok: boolean; items: { id: string; createdAt: string; size: number }[] }>;
  readDocBackup?: (filePath: string, id: string) => Promise<{ ok: boolean; text?: string }>;
  setFileAssociation?: (ext: "md" | "txt" | "json" | "yaml" | "data" | "pdf", enabled: boolean) => Promise<{ ok: boolean; reason?: string }>;
  onDocsRequestClose?: (cb: () => void) => void;
  docsCloseResult?: (proceed: boolean) => void;
  openFilesWindow?: () => Promise<void>;
  onDocsFlushRequest?: (cb: () => void) => void;
  docsFlushComplete?: () => void;
  notifyScratchpadChanged?: () => void;
  onScratchpadChanged?: (cb: () => void) => () => void;
  spellcheckWords: (words: string[]) => Promise<string[]>;
  spellcheckSuggest: (word: string) => Promise<string[]>;
  addCustomWord: (word: string) => Promise<void>;
  onFlushRequest: (cb: () => void) => void;
  flushComplete: () => void;
  checkForUpdates?: () => Promise<UpdateCheckResult>;
  downloadUpdate?: () => Promise<{ ok: boolean; reason?: string }>;
  installUpdate?: () => Promise<{ ok: boolean; reason?: string }>;
  onUpdateEvent?: (cb: (name: "update-progress" | "update-ready" | "update-error", payload: any) => void) => void;
}

interface DocFilePayload {
  ok: boolean;
  reason?: string;
  path: string;
  name: string;
  ext: string;
  editable: boolean;
  /** UTF-8 text for editable files. */
  text?: string;
  /** Base64 PDF bytes. Present only for read-only .pdf files. */
  pdfBase64?: string;
}

interface UpdateCheckResult {
  status: "available" | "current" | "unsupported" | "error";
  current: string;
  latest?: string;
  canInstall: boolean;
  /** "", "unsigned", "portable", "platform" or "dev" */
  reason: string;
  message?: string;
  releasesUrl: string;
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
