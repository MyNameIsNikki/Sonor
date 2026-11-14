// Мост между изолированным рендерером (index.html) и главным процессом.
// Рендерер не имеет доступа к Node: он вызывает только перечисленные каналы.
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_CHANNELS = new Set([
  'open-external',
  'check-token',
  'oauth-config-get',
  'oauth-config-save',
  'oauth-status',
  'oauth-login',
  'oauth-yandex-start',
  'oauth-yandex-poll',
  'oauth-logout',
  'free-search',
  'free-resolve',
  'free-download',
  'import-playlist-file',
  'load-library',
  'save-library',
  'import-music',
  'import-link',
  'get-saved-services',
  'sync-saved',
  'resolve-track-url',
  'resolve-spotify-preview',
  'lyrics-lookup',
  'read-audio-tags',
  'install-update'
]);

const SEND_CHANNELS = new Set([
  'minimize-window',
  'maximize-window',
  'close-window'
]);

const RECEIVE_CHANNELS = new Set([
  'import-progress',
  'update-status'
]);

// pathToFileURL без модуля url: песочница не даёт require('url').
function pathToFileURL(filePath) {
  if (!filePath) return null;
  let normalized = String(filePath).replace(/\\/g, '/');
  // Windows может отдать extended-length путь: \\?\C:\Music или
  // \\?\UNC\server\share. Убираем префикс, иначе '?' попадёт в URL.
  if (normalized.startsWith('//?/UNC/')) {
    normalized = '//' + normalized.slice(8);
  } else if (normalized.startsWith('//?/')) {
    normalized = normalized.slice(4);
  }
  // Сетевой путь \\server\share должен превращаться в file://server/share,
  // а не в file:////server/share с пустым хостом.
  const isUnc = normalized.startsWith('//');
  if (!isUnc && !normalized.startsWith('/')) normalized = '/' + normalized;
  const encoded = normalized
    .split('/')
    .map(function (segment) {
      if (segment === '') return '';
      // Двоеточие в букве диска (C:) кодировать нельзя
      return encodeURIComponent(segment).replace(/%3A/gi, ':');
    })
    .join('/');
  return isUnc ? 'file:' + encoded : 'file://' + encoded;
}

contextBridge.exposeInMainWorld('sonor', {
  platform: process.platform,
  invoke: function (channel, payload) {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error('Канал не разрешён: ' + channel));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  send: function (channel) {
    if (!SEND_CHANNELS.has(channel)) return;
    ipcRenderer.send(channel);
  },
  on: function (channel, callback) {
    if (!RECEIVE_CHANNELS.has(channel) || typeof callback !== 'function') return;
    const listener = function (_event, data) { callback(data); };
    ipcRenderer.on(channel, listener);
    return function () { ipcRenderer.removeListener(channel, listener); };
  },
  pathToFileURL: pathToFileURL
});
