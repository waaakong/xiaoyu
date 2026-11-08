const { contextBridge, ipcRenderer } = require('electron');
const call = (action, value) => ipcRenderer.invoke('desktop', action, value);
contextBridge.exposeInMainWorld('desktop', {
  native: true,
  windowAction: action => call(action),
  setDirty: value => call('dirty', value),
  setTheme: value => call('theme', value),
  openDependencyPage: key => call('dependency', key),
  openPluginDashboard: () => call('plugins'),
  openServiceDashboard: kind => call('service', kind)
});
ipcRenderer.on('window-state', (_event, state) => {
  window.dispatchEvent(new CustomEvent('desktop-window-state', { detail: state }));
});
