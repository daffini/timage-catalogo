const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('catalog', {
  // Dati
  readJson: (relativePath) => ipcRenderer.invoke('read-json', relativePath),
  readSvg: (relativePath) => ipcRenderer.invoke('read-svg', relativePath),
  resolveDataPath: (relativePath) => ipcRenderer.invoke('resolve-data-path', relativePath),
  getDataPath: () => ipcRenderer.invoke('get-data-path'),
  listFiles: (relativePath, extension) => ipcRenderer.invoke('list-files', relativePath, extension),
  listModels: () => ipcRenderer.invoke('list-models'),

  // Export / Salvataggio
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  saveBinary: (options) => ipcRenderer.invoke('save-binary', options),
});
