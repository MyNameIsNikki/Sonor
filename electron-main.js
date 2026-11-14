const { app, BrowserWindow, ipcMain, Menu, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { importService, importPublicLink, resolveYandexStream, resolveSpotifyPreview, checkToken } = require('./src/services/importers');
const { searchFreeMusic, resolveAudiusStream, downloadFreeTrack } = require('./src/services/freeMusic');
const { importPlaylistFile } = require('./src/services/playlistImport');
const tokenStore = require('./src/services/tokenStore');
const oauth = require('./src/services/oauth');
const libraryStore = require('./src/services/libraryStore');
const { lookupLyrics } = require('./src/services/lyrics');

// Стабильная папка данных: не зависит от имени исполняемого файла и
// productName в установщике, поэтому библиотека переживает обновления.
// SONOR_DATA_DIR задаёт свою папку — портативный режим и тесты.
app.setName('Sonor');
const dataRoot = process.env.SONOR_DATA_DIR
  ? path.resolve(process.env.SONOR_DATA_DIR)
  : path.join(app.getPath('appData'), 'Sonor');
app.setPath('userData', dataRoot);

let mainWindow;

// Один экземпляр приложения: повторный запуск открывает существующее окно.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Рабочая копия токенов в памяти. На диск они попадают только по желанию
// пользователя — в зашифрованном виде через tokenStore.
const importTokens = new Map();

// ---------- Позиция окна переживает перезапуск ----------
function windowStateFile() {
  return path.join(dataRoot, 'window-state.json');
}

function loadWindowState() {
  try {
    const raw = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
    if (!raw || typeof raw.width !== 'number' || typeof raw.height !== 'number') return null;
    return raw;
  } catch (err) {
    return null;
  }
}

function saveWindowState(win) {
  if (!win || win.isMinimized() || win.isDestroyed()) return;
  try {
    const bounds = win.getBounds();
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.writeFileSync(windowStateFile(), JSON.stringify(bounds), 'utf8');
  } catch (err) { /* не критично */ }
}

// Меню скрыто (autoHideMenuBar), но именно оно даёт рабочие Ctrl+C / Ctrl+V /
// Ctrl+Z / Ctrl+A в полях ввода — без него вставка токенов не работает.
function installMenu() {
  const template = [
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Перезагрузить' },
        { role: 'forceReload', label: 'Перезагрузить принудительно' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Масштаб 100%' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Во весь экран' }
      ]
    },
    {
      label: 'Окно',
      submenu: [
        { role: 'minimize', label: 'Свернуть' },
        { role: 'zoom', label: 'Развернуть' },
        { role: 'close', label: 'Закрыть' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const saved = loadWindowState();
  const width = saved ? Math.min(saved.width, workArea.width) : Math.min(1280, Math.max(900, workArea.width - 48));
  const height = saved ? Math.min(saved.height, workArea.height) : Math.min(820, Math.max(620, workArea.height - 48));

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    x: saved && typeof saved.x === 'number' ? saved.x : undefined,
    y: saved && typeof saved.y === 'number' ? saved.y : undefined,
    minWidth: 900,
    minHeight: 620,
    center: !saved,
    backgroundColor: '#0f2027',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    },
    frame: false,
    titleBarStyle: 'hidden',
    title: 'Sonor Music Player',
    icon: path.join(__dirname, 'icon.png')
  });

  installMenu();

  // Ссылки на сайты сервисов открываем в системном браузере, а не внутри
  // приложения: иначе страница OAuth заменяет сам плеер.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = event.sender.getURL();
    const devUrl = 'http://localhost:19006';
    const internal =
      url === currentUrl ||
      url.startsWith('file://') ||
      (process.env.NODE_ENV === 'development' && (url === devUrl || url.startsWith(devUrl + '/')));
    if (internal) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:19006');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  mainWindow.on('close', () => {
    saveWindowState(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function migrateLegacyData() {
  const legacyNames = ['Sonor Music Player', 'electron', 'sonor', 'SonorMusicPlayer'];
  const appData = app.getPath('appData');
  ['library.json', 'tokens.json'].forEach(function (file) {
    const target = path.join(dataRoot, file);
    if (fs.existsSync(target)) return;

    let newest = null;
    legacyNames.forEach(function (name) {
      const source = path.join(appData, name, file);
      try {
        const stat = fs.statSync(source);
        if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { source: source, mtimeMs: stat.mtimeMs };
      } catch (err) { /* нет файла — пропускаем */ }
    });

    if (!newest) return;
    try {
      fs.mkdirSync(dataRoot, { recursive: true });
      fs.copyFileSync(newest.source, target);
      console.log('Перенесены данные из ' + newest.source);
    } catch (err) {
      console.error('Не удалось перенести ' + file + ':', err.message);
    }
  });
}

app.whenReady().then(() => {
  migrateLegacyData();
  const storedTokens = tokenStore.loadTokens();
  Object.keys(storedTokens).forEach(function (service) {
    if (storedTokens[service]) importTokens.set(service, storedTokens[service]);
  });

  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Второй запуск приложения — выводим существующее окно на передний план
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ---------- Window controls ----------
ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('maximize-window', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.on('close-window', () => {
  if (mainWindow) mainWindow.close();
});

// ---------- External links & auth ----------
ipcMain.handle('open-external', async (event, url) => {
  const value = String(url || '');
  if (!/^https?:\/\//i.test(value)) return { ok: false };
  await shell.openExternal(value);
  return { ok: true };
});

ipcMain.handle('check-token', async (event, payload) => {
  const service = payload && payload.service;
  let token = payload && payload.token;
  try {
    if (!token && payload && payload.saved) {
      token = await oauth.getValidToken(service);
    }
    const account = await checkToken(service, token);
    return { ok: true, account: account };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// ---------- OAuth connection center ----------
function oauthFailure(err) {
  return { ok: false, error: err && err.message ? err.message : String(err) };
}

ipcMain.handle('oauth-config-get', async () => {
  try {
    return {
      ok: true,
      config: oauth.loadConfig(),
      status: await oauth.getAuthStatus()
    };
  } catch (err) {
    return oauthFailure(err);
  }
});

ipcMain.handle('oauth-config-save', async (event, payload) => {
  try {
    const config = await oauth.saveConfig(payload && payload.config ? payload.config : payload);
    return { ok: true, config: config, status: await oauth.getAuthStatus() };
  } catch (err) {
    return oauthFailure(err);
  }
});

ipcMain.handle('oauth-status', async () => {
  try {
    return { ok: true, status: await oauth.getAuthStatus() };
  } catch (err) {
    return oauthFailure(err);
  }
});

ipcMain.handle('oauth-login', async (event, payload) => {
  const service = payload && payload.service;
  try {
    if (['vk', 'spotify'].indexOf(service) === -1) {
      throw new Error('Для Яндекса используется вход по коду устройства');
    }
    const result = await oauth.login(service, mainWindow);
    return Object.assign({ ok: true }, result);
  } catch (err) {
    return oauthFailure(err);
  }
});

ipcMain.handle('oauth-yandex-start', async () => {
  try {
    return Object.assign({ ok: true }, await oauth.startYandexDevice());
  } catch (err) {
    return oauthFailure(err);
  }
});

ipcMain.handle('oauth-yandex-poll', async (event, payload) => {
  try {
    return await oauth.pollYandexDevice(payload && payload.flowId);
  } catch (err) {
    return oauthFailure(err);
  }
});

ipcMain.handle('oauth-logout', async (event, payload) => {
  try {
    await oauth.logout(payload && payload.service);
    importTokens.delete(payload && payload.service);
    return { ok: true, status: await oauth.getAuthStatus() };
  } catch (err) {
    return oauthFailure(err);
  }
});

// ---------- Free music (Audius / ccMixter / Internet Archive) ----------
ipcMain.handle('free-search', async (event, payload) => {
  const source = payload && payload.source ? String(payload.source) : 'all';
  if (['all', 'audius', 'ccmixter', 'archive'].indexOf(source) === -1) {
    throw new Error('Неизвестный каталог');
  }
  const query = String((payload && payload.query) || 'lofi').trim().slice(0, 80) || 'lofi';
  try {
    const result = await searchFreeMusic(query, source);
    return Object.assign({ ok: true }, result);
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('free-resolve', async (event, payload) => {
  const id = payload && payload.id;
  if (!id) return { ok: false, error: 'Не указан трек Audius' };
  try {
    const url = await resolveAudiusStream(String(id));
    return { ok: true, url: url };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('free-download', async (event, payload) => {
  try {
    const url = payload && payload.url ? String(payload.url) : '';
    if (!url) throw new Error('Не указана ссылка на файл');
    if (payload && payload.source === 'audius') {
      throw new Error('Audius разрешает только прослушивание');
    }

    const destination = path.join(app.getPath('music'), 'Sonor');
    const result = await downloadFreeTrack(url, destination, {
      title: payload && payload.title ? String(payload.title).slice(0, 180) : 'track',
      artist: payload && payload.artist ? String(payload.artist).slice(0, 180) : '',
      source: payload && payload.source ? String(payload.source) : ''
    });
    return { ok: true, path: result.path, size: result.size, name: result.name };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// ---------- Playlist files (M3U / PLS / XSPF / CSV / JSON) ----------
ipcMain.handle('import-playlist-file', async (event, payload) => {
  const filePath = payload && payload.path ? String(payload.path) : '';
  if (!filePath) return { ok: false, error: 'Файл плейлиста не выбран' };
  try {
    const result = importPlaylistFile(filePath);
    return Object.assign({ ok: true }, result);
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// ---------- Persistence ----------
function libraryFile() {
  return path.join(app.getPath('userData'), 'library.json');
}

function emptyLibrary() {
  return { tracks: [], collections: [], stats: emptyStats(), savedAt: null };
}

// Санитайзеры вынесены в src/services/libraryStore.js — их тестирует node --test.
const sanitizeTrack = libraryStore.sanitizeTrack;
const sanitizeCollection = libraryStore.sanitizeCollection;
const sanitizeStats = libraryStore.sanitizeStats;
const emptyStats = libraryStore.emptyStats;

function sanitizeLibrary(input) {
  return libraryStore.sanitizeLibrary(input);
}

function readLibrary() {
  try {
    const raw = fs.readFileSync(libraryFile(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tracks)) {
      throw new Error('Формат файла библиотеки повреждён');
    }
    const tracks = parsed.tracks.map(sanitizeTrack).filter(Boolean);
    const collections = Array.isArray(parsed.collections)
      ? parsed.collections.map(sanitizeCollection).filter(Boolean)
      : [];
    // Непустой список, из которого не выжил ни один трек, почти наверняка
    // означает повреждённую схему. Не отдаём его как «пустую библиотеку»,
    // иначе автосохранение затрёт исходные данные.
    if (parsed.tracks.length && !tracks.length) {
      throw new Error('В библиотеке не осталось корректных треков');
    }
    return {
      tracks: tracks,
      collections: collections,
      stats: sanitizeStats(parsed.stats),
      savedAt: parsed.savedAt || null
    };
  } catch (err) {
    if (err.code === 'ENOENT') return emptyLibrary();
    console.error('Не удалось прочитать библиотеку:', err.message);
    throw err;
  }
}

async function saveLibrary(input) {
  const data = sanitizeLibrary(input);
  const target = libraryFile();
  const temp = target + '.tmp';
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(temp, JSON.stringify(data), 'utf8');
  await fs.promises.rename(temp, target);
  return { ok: true, savedAt: data.savedAt };
}

// Записи библиотеки должны выполняться строго по очереди: два параллельных
// сохранения используют один временный файл и могут испортить library.json.
let librarySaveChain = Promise.resolve();

ipcMain.handle('load-library', async () => readLibrary());

ipcMain.handle('save-library', async (event, payload) => {
  const task = librarySaveChain.then(
    () => saveLibrary(payload),
    () => saveLibrary(payload)
  );
  librarySaveChain = task.catch(function () {});
  try {
    return await task;
  } catch (err) {
    console.error('Не удалось сохранить библиотеку:', err.message);
    return { ok: false, error: err.message };
  }
});

// ---------- Теги и обложки локальных файлов ----------
let mm = null;
function musicMetadata() {
  if (!mm) mm = require('music-metadata');
  return mm;
}

function coversDir() {
  return path.join(app.getPath('userData'), 'covers');
}

// Обложка сохраняется на диск один раз — путь стабилен по содержимому файла
async function saveCover(pictures) {
  const list = (Array.isArray(pictures) ? pictures : []).filter(function (pic) {
    return pic && pic.data && pic.data.length;
  });
  if (!list.length) return null;
  const pic = list.reduce(function (best, item) {
    return !best || item.data.length > best.data.length ? item : best;
  }, null);

  const dir = coversDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const hash = crypto.createHash('sha1').update(pic.data).digest('hex').slice(0, 24);
  const extension = /png/i.test(String(pic.format)) ? '.png' : '.jpg';
  const file = path.join(dir, hash + extension);
  try {
    await fs.promises.access(file);
  } catch (err) {
    await fs.promises.writeFile(file, pic.data);
  }
  return file;
}

function withTimeout(promise, ms) {
  return new Promise(function (resolve) {
    const timer = setTimeout(function () { resolve(null); }, ms);
    promise.then(function (value) {
      clearTimeout(timer);
      resolve(value);
    }, function () {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function readOneTags(audioPath) {
  try {
    if (!fs.existsSync(audioPath) || !fs.statSync(audioPath).isFile()) return { ok: false };
    const metadata = await withTimeout(musicMetadata().parseFile(audioPath, { duration: true, skipCovers: false }), 10000);
    if (!metadata) return { ok: false };
    const common = metadata.common || {};
    const coverPath = await saveCover(common.picture);
    return {
      ok: true,
      title: text2(common.title) || null,
      artist: text2(common.artist) || (common.artists && common.artists[0]) || null,
      album: text2(common.album) || null,
      duration: metadata.format && isFinite(metadata.format.duration) ? Math.round(metadata.format.duration) : null,
      year: common.year || null,
      genre: common.genre && common.genre[0] ? common.genre[0] : null,
      coverPath: coverPath
    };
  } catch (err) {
    return { ok: false };
  }
}

function text2(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

ipcMain.handle('read-audio-tags', async (event, payload) => {
  const paths = (payload && Array.isArray(payload.paths) ? payload.paths : [])
    .slice(0, 500)
    .map(function (value) { return String(value || ''); })
    .filter(Boolean);
  if (!paths.length) return { results: [] };

  const results = new Array(paths.length);
  let cursor = 0;
  async function worker() {
    while (cursor < paths.length) {
      const index = cursor++;
      results[index] = await readOneTags(paths[index]);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(4, paths.length); i++) workers.push(worker());
  await Promise.all(workers);
  return { results: results };
});

// ---------- Автообновление (GitHub Releases) ----------
function setupAutoUpdater() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('electron-updater недоступен:', err.message);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  function notify(status, info) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', { status: status, info: info || null });
    }
  }

  autoUpdater.on('checking-for-update', function () { notify('checking'); });
  autoUpdater.on('update-available', function (info) { notify('available', info); });
  autoUpdater.on('update-not-available', function () { notify('none'); });
  autoUpdater.on('error', function (err) { notify('error', { message: err && err.message ? err.message : String(err) }); });
  autoUpdater.on('download-progress', function (progress) {
    notify('downloading', { percent: Math.round(progress.percent || 0) });
  });
  autoUpdater.on('update-downloaded', function (info) { notify('downloaded', info); });

  setTimeout(function () { autoUpdater.checkForUpdates().catch(function () { /* нет сети — не мешаем */ }); }, 8000);
}

ipcMain.handle('install-update', async () => {
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    return { ok: false, error: 'Модуль обновлений недоступен' };
  }
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

// ---------- Import ----------
function reportProgress(event, progress) {
  if (event.sender && !event.sender.isDestroyed()) {
    event.sender.send('import-progress', progress);
  }
}

ipcMain.handle('import-music', async (event, payload) => {
  const service = payload && payload.service;
  const provided = payload && payload.token && String(payload.token).trim();
  const remember = payload && payload.remember !== false;

  if (['vk', 'yandex', 'spotify'].indexOf(service) === -1) {
    throw new Error('Неизвестный сервис: ' + service);
  }

  const saved = provided ? null : await oauth.getValidToken(service);
  const token = provided || saved;
  if (!token) throw new Error('Токен не указан');

  importTokens.set(service, token);

  const result = await importService(service, token, function (progress) {
    reportProgress(event, progress);
  });

  if (provided || !remember) {
    if (remember && provided) {
      try {
        await tokenStore.saveToken(service, token);
      } catch (err) {
        result.warnings = (result.warnings || []).concat('Токен не сохранён: ' + err.message);
      }
    } else {
      await tokenStore.removeToken(service).catch(function () {});
      // Оставляем токен в памяти до закрытия приложения: он нужен для
      // получения свежих ссылок на треки во время текущей сессии.
    }
  }

  result.remembered = tokenStore.savedServices().indexOf(service) !== -1;
  return result;
});

ipcMain.handle('import-link', async (event, payload) => {
  const link = payload && payload.url;
  return importPublicLink(link, function (progress) {
    reportProgress(event, progress);
  });
});

ipcMain.handle('get-saved-services', async () => {
  return {
    services: tokenStore.savedServices(),
    encryptionAvailable: tokenStore.encryptionAvailable()
  };
});

ipcMain.handle('forget-token', async (event, payload) => {
  const service = payload && payload.service;
  if (tokenStore.SERVICES.indexOf(service) === -1) throw new Error('Неизвестный сервис');
  await tokenStore.removeToken(service);
  importTokens.delete(service);
  return { services: tokenStore.savedServices() };
});

ipcMain.handle('sync-saved', async (event) => {
  const services = tokenStore.savedServices();
  if (!services.length) return { results: {}, errors: {}, services: [] };

  const results = {};
  const errors = {};
  for (let i = 0; i < services.length; i++) {
    const service = services[i];
    try {
      const token = await oauth.getValidToken(service);
      if (!token) throw new Error('Сохранённый токен не найден');
      importTokens.set(service, token);
      results[service] = await importService(service, token, function (progress) {
        reportProgress(event, progress);
      });
    } catch (err) {
      errors[service] = err.message || String(err);
    }
  }
  return { results: results, errors: errors, services: services };
});

ipcMain.handle('resolve-track-url', async (event, payload) => {
  const id = payload && payload.id;
  if (!id) throw new Error('Не указан идентификатор трека');

  let token = importTokens.get('yandex') || null;
  if (!token) {
    try {
      token = await oauth.getValidToken('yandex');
    } catch (err) {
      token = null;
    }
  }
  if (!token && !(payload && payload.public)) {
    throw new Error('Ссылки Яндекс Музыки истекли. Импортируйте музыку заново.');
  }

  const url = await resolveYandexStream(String(id).replace(/^yandex_/, ''), token);
  return { url: url };
});

// 30-секундное превью Spotify: Web API больше не отдаёт preview_url,
// берём его с публичной embed-страницы трека.
ipcMain.handle('resolve-spotify-preview', async (event, payload) => {
  const id = payload && payload.id;
  if (!id) return { ok: false, error: 'Не указан идентификатор трека' };
  try {
    const info = await resolveSpotifyPreview(String(id));
    return { ok: true, url: info.previewUrl, duration: info.duration };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// Тексты песен ищутся в открытой базе LRCLib и не зависят от источника трека.
ipcMain.handle('lyrics-lookup', async (event, payload) => {
  try {
    return await lookupLyrics(payload || {});
  } catch (err) {
    return {
      found: false,
      synced: false,
      lines: [],
      plain: '',
      error: err && err.message ? err.message : String(err)
    };
  }
});
