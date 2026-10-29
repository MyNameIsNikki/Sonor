const { app, BrowserWindow, ipcMain, Menu, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { importService, importPublicLink, resolveYandexStream, checkToken } = require('./src/services/importers');
const { searchFreeMusic, resolveAudiusStream, downloadFreeTrack } = require('./src/services/freeMusic');
const { importPlaylistFile } = require('./src/services/playlistImport');
const tokenStore = require('./src/services/tokenStore');

// Стабильная папка данных: не зависит от имени исполняемого файла и
// productName в установщике, поэтому библиотека переживает обновления.
app.setName('Sonor');
const dataRoot = path.join(app.getPath('appData'), 'Sonor');
app.setPath('userData', dataRoot);

let mainWindow;

// Рабочая копия токенов в памяти. На диск они попадают только по желанию
// пользователя — в зашифрованном виде через tokenStore.
const importTokens = new Map();

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1280, Math.max(900, workArea.width - 48));
  const height = Math.min(820, Math.max(620, workArea.height - 48));

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    minWidth: 900,
    minHeight: 620,
    center: true,
    backgroundColor: '#0f2027',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    },
    frame: false,
    titleBarStyle: 'hidden',
    title: 'Sonor Music Player',
    icon: path.join(__dirname, 'icon.png')
  });

  Menu.setApplicationMenu(null);

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
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
      token = tokenStore.loadTokens()[service];
    }
    const account = await checkToken(service, token);
    return { ok: true, account: account };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
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
  return { tracks: [], collections: [], savedAt: null };
}

function sanitizeTrack(track) {
  if (!track || !track.id) return null;
  return {
    id: String(track.id),
    externalId: track.externalId ? String(track.externalId) : null,
    title: String(track.title || 'Без названия'),
    artist: String(track.artist || 'Неизвестный исполнитель'),
    album: String(track.album || ''),
    duration: Number(track.duration) || 0,
    url: track.url || null,
    path: track.path ? String(track.path) : null,
    image: track.image || null,
    source: String(track.source || ''),
    provider: track.provider ? String(track.provider) : null,
    origin: track.origin ? String(track.origin) : null,
    public: track.public === true,
    license: track.license ? String(track.license).slice(0, 240) : null,
    licenseUrl: track.licenseUrl ? String(track.licenseUrl) : null,
    filePageUrl: track.filePageUrl ? String(track.filePageUrl) : null,
    downloadable: track.downloadable === true,
    streamOnly: track.streamOnly === true
  };
}

function sanitizeCollection(collection) {
  if (!collection || !collection.id) return null;
  return {
    id: String(collection.id),
    source: String(collection.source || ''),
    type: String(collection.type || 'playlist'),
    title: String(collection.title || 'Без названия'),
    subtitle: String(collection.subtitle || ''),
    image: collection.image || null,
    trackIds: Array.isArray(collection.trackIds)
      ? collection.trackIds.slice(0, 20000).map(String)
      : []
  };
}

function sanitizeLibrary(input) {
  const data = input && typeof input === 'object' ? input : {};
  const tracks = Array.isArray(data.tracks)
    ? data.tracks.slice(0, 20000).map(sanitizeTrack).filter(Boolean)
    : [];
  const collections = Array.isArray(data.collections)
    ? data.collections.slice(0, 2000).map(sanitizeCollection).filter(Boolean)
    : [];
  return { version: 1, tracks: tracks, collections: collections, savedAt: new Date().toISOString() };
}

function readLibrary() {
  try {
    const raw = fs.readFileSync(libraryFile(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tracks)) return emptyLibrary();
    return {
      tracks: parsed.tracks.map(sanitizeTrack).filter(Boolean),
      collections: Array.isArray(parsed.collections)
        ? parsed.collections.map(sanitizeCollection).filter(Boolean)
        : [],
      savedAt: parsed.savedAt || null
    };
  } catch (err) {
    if (err.code === 'ENOENT') return emptyLibrary();
    console.error('Не удалось прочитать библиотеку:', err.message);
    return emptyLibrary();
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

ipcMain.handle('load-library', async () => readLibrary());

ipcMain.handle('save-library', async (event, payload) => {
  try {
    return await saveLibrary(payload);
  } catch (err) {
    console.error('Не удалось сохранить библиотеку:', err.message);
    return { ok: false, error: err.message };
  }
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

  const saved = tokenStore.loadTokens()[service];
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
  const tokens = tokenStore.loadTokens();
  const services = Object.keys(tokens).filter(function (service) {
    return !!tokens[service] && ['vk', 'yandex', 'spotify'].indexOf(service) !== -1;
  });
  if (!services.length) return { results: {}, errors: {}, services: [] };

  const results = {};
  const errors = {};
  for (let i = 0; i < services.length; i++) {
    const service = services[i];
    importTokens.set(service, tokens[service]);
    try {
      results[service] = await importService(service, tokens[service], function (progress) {
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

  const token = importTokens.get('yandex') || null;
  if (!token && !(payload && payload.public)) {
    throw new Error('Ссылки Яндекс Музыки истекли. Импортируйте музыку заново.');
  }

  const url = await resolveYandexStream(String(id).replace(/^yandex_/, ''), token);
  return { url: url };
});
