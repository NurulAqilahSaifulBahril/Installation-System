const { contextBridge, shell } = require('electron');

contextBridge.exposeInMainWorld('installationDesktop', {
  isElectron: true,
  openExternal: (url) => shell.openExternal(url),
});
