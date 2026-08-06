const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('installationDesktop', {
  isElectron: true,
  openExternal: (url) => shell.openExternal(url),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
});
