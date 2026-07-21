const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('octaveDesktop', Object.freeze({
  isDesktop: true,
  getProviderSettings: () => ipcRenderer.invoke('octave:get-provider-settings'),
  checkCliProvider: (input) => ipcRenderer.invoke('octave:check-cli-provider', input),
  launchCliProviderSetup: (input) => ipcRenderer.invoke('octave:launch-cli-provider-setup', input),
  pickWorkspace: () => ipcRenderer.invoke('octave:pick-workspace'),
  saveProviderSettings: (settings) => ipcRenderer.invoke('octave:save-provider-settings', settings),
}));
