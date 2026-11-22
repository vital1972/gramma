// Мост между окнами и программой: только перечисленные действия.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const SEND = ['phone:read', 'phone:later', 'phone:menu', 'settings:lock'];
const INVOKE = [
  'session:data', 'session:task', 'session:quiz', 'session:vacation', 'session:end', 'en:data', 'en:save',
  'settings:state', 'settings:unlock', 'settings:save', 'settings:pin', 'settings:telegramTest', 'settings:findChat',
  'settings:stopSession', 'settings:startNow', 'settings:checkUpdates', 'settings:resetProgress', 'settings:quit',
];
const ON = ['phone:update', 'settings:changed'];

contextBridge.exposeInMainWorld('oshibkin', {
  send(ch, data) { if (SEND.includes(ch)) ipcRenderer.send(ch, data); },
  invoke(ch, data) { return INVOKE.includes(ch) ? ipcRenderer.invoke(ch, data) : Promise.reject(new Error('нет такого действия')); },
  on(ch, fn) { if (ON.includes(ch)) ipcRenderer.on(ch, (_e, d) => fn(d)); },
});
