const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  isElectron: true,
  checkOllamaInstalled: () => ipcRenderer.invoke("check-ollama-installed"),
  installOllama: () => ipcRenderer.invoke("install-ollama"),
  startOllama: () => ipcRenderer.invoke("start-ollama"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
