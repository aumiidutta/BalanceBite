'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The only doorway between the page and the system. Nothing else is exposed.
contextBridge.exposeInMainWorld('api', {
  getProfile: () => ipcRenderer.invoke('profile:get'),
  saveProfile: (p) => ipcRenderer.invoke('profile:save', p),
  generate: (mode, input) => ipcRenderer.invoke('ai:generate', mode, input),
  onStatus: (cb) => ipcRenderer.on('ai:status', (_e, s) => cb(String(s))),
  saveDoc: (html, title) => ipcRenderer.invoke('doc:save', html, title),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
});
