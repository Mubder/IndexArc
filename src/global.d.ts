interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
