const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('octaveDesktop', Object.freeze({
  isDesktop: true,
  pickWorkspace: () => ipcRenderer.invoke('octave:pick-workspace'),
}));
