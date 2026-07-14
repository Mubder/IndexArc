interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  isElectron: boolean;
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

export {};
