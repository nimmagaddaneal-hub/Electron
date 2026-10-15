const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meridian', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setKey: (key) => ipcRenderer.invoke('settings:setKey', key),
    setModel: (model) => ipcRenderer.invoke('settings:setModel', model),
    setProvider: (p) => ipcRenderer.invoke('settings:setProvider', p),
    pickFolder: () => ipcRenderer.invoke('settings:pickFolder'),
    clearFolder: () => ipcRenderer.invoke('settings:clearFolder'),
    planLogin: () => ipcRenderer.invoke('plan:login'),
  },
  ai: {
    chat: (req) => ipcRenderer.invoke('ai:chat', req),
    planChat: (req) => ipcRenderer.invoke('ai:planChat', req),
    abort: (id) => ipcRenderer.invoke('ai:abort', id),
    onEvent: (cb) => ipcRenderer.on('ai:event', (_e, data) => cb(data)),
  },
  onCommand: (cb) => ipcRenderer.on('cmd', (_e, data) => cb(data)),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  platform: process.platform,
});
