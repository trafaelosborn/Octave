const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('octaveDesktop', Object.freeze({
  isDesktop: true,
  getProviderSettings: () => ipcRenderer.invoke('octave:get-provider-settings'),
  pickWorkspace: () => ipcRenderer.invoke('octave:pick-workspace'),
  saveProviderSettings: (settings) => ipcRenderer.invoke('octave:save-provider-settings', settings),
}));
