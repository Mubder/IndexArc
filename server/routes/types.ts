import type { VaultStore } from "../store.js";
import type { FolderWatcherManager } from "../services/folderWatcher.js";
import type { PortablePaths } from "../paths.js";

export interface SpellcheckEngines {
  arSpell: any;
  enSpell: any;
  userDictPath: string;
  ignoredDictPath: string;
  findMisspelled: (words: string[], ar: any, en: any) => Promise<string[]>;
  suggestArabicWord: (word: string, ar: any, limit?: number) => Promise<string[]>;
  suggestEnglishWord: (word: string, en: any, limit?: number) => Promise<string[]>;
  isArabicToken: (word: string) => boolean;
  isLatinToken: (w: string) => boolean;
  addCustomWord: (word: string, dictPath: string, ar: any, en: any) => void;
  checkArabicWord: (w: string, ar: any) => boolean;
  checkEnglishWord: (w: string, en: any) => boolean;
}

export interface RouteContext {
  store: VaultStore;
  watchers: FolderWatcherManager;
  paths: PortablePaths;
  spellcheck?: SpellcheckEngines;
}
