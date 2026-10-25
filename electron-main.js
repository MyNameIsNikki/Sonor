const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const path = require('path');
const https = require('https');

let mainWindow;

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

app.whenReady().then(() => {
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

// ---------- HTTP helper ----------
function getJson(targetUrl, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(targetUrl, { headers: headers || {} }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error('HTTP ' + res.statusCode + ': ' + data.slice(0, 180).replace(/\s+/g, ' ')));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Некорректный ответ API: ' + data.slice(0, 180).replace(/\s+/g, ' ')));
        }
      });
    });
    req.setTimeout(20000, () => {
      req.destroy(new Error('Превышено время ожидания ответа API'));
    });
    req.on('error', reject);
  });
}

const MAX_TRACKS = 500;

// ---------- VK Music ----------
async function importVK(token) {
  const data = await getJson(
    'https://api.vk.com/method/audio.get?access_token=' + encodeURIComponent(token) +
    '&v=5.131&count=200'
  );
  if (data.error) {
    throw new Error(data.error.error_msg || data.error.error_message || 'Ошибка VK API');
  }
  const items = (data.response && data.response.items) || [];
  return items.slice(0, MAX_TRACKS).map((item) => ({
    id: 'vk_' + item.id,
    title: item.title || 'Без названия',
    artist: item.artist || 'Неизвестно',
    album: '',
    duration: typeof item.duration === 'number' ? item.duration : 0,
    url: item.url || null,
    source: 'vk'
  }));
}

// ---------- Yandex Music ----------
async function importYandex(token) {
  const headers = { Authorization: 'OAuth ' + token };
  const playlistsData = await getJson('https://api.music.yandex.net/users/me/playlists', headers);

  const playlists =
    (playlistsData.result && playlistsData.result.playlists) ||
    playlistsData.playlists ||
    (Array.isArray(playlistsData.result) ? playlistsData.result : []);

  if (!playlists.length) {
    throw new Error('Плейлисты не найдены. Проверьте токен Яндекс Музыки.');
  }

  const out = [];
  for (const playlist of playlists) {
    if (out.length >= MAX_TRACKS) break;
    const kind = playlist.kind;
    if (kind === undefined || kind === null) continue;
    try {
      const tracksData = await getJson(
        'https://api.music.yandex.net/users/me/playlists/' + kind + '/tracks',
        headers
      );
      const raw =
        (tracksData.result && tracksData.result.tracks) ||
        tracksData.tracks ||
        (Array.isArray(tracksData.result) ? tracksData.result : []);

      raw.forEach((entry) => {
        if (out.length >= MAX_TRACKS) return;
        const track = entry.track || entry;
        if (!track) return;
        const artists = Array.isArray(track.artists)
          ? track.artists.map((a) => a.name).filter(Boolean).join(', ')
          : '';
        out.push({
          id: 'yandex_' + (track.id || Math.random().toString(36).slice(2)),
          title: track.title || track.name || 'Без названия',
          artist: artists || 'Неизвестно',
          album: (track.albums && track.albums[0] && track.albums[0].title) || '',
          duration: track.durationMs ? track.durationMs / 1000 : (track.duration || 0),
          url: track.preview || null,
          source: 'yandex'
        });
      });
    } catch (err) {
      // Skip individual playlist failures, keep importing the rest
    }
  }

  if (!out.length) {
    throw new Error('Не удалось получить треки Яндекс Музыки.');
  }
  return out;
}

// ---------- Spotify ----------
async function importSpotify(token) {
  const headers = { Authorization: 'Bearer ' + token };
  const out = [];
  let nextUrl = 'https://api.spotify.com/v1/me/playlists?limit=50';
  let pages = 0;

  while (nextUrl && out.length < MAX_TRACKS && pages < 10) {
    pages++;
    const data = await getJson(nextUrl, headers);
    if (data.error) {
      throw new Error(data.error.message || 'Ошибка Spotify API');
    }

    const items = data.items || [];
    for (const playlist of items) {
      if (out.length >= MAX_TRACKS) break;
      if (!playlist || !playlist.id) continue;
      try {
        const tracksData = await getJson(
          'https://api.spotify.com/v1/playlists/' + playlist.id + '/tracks?limit=100',
          headers
        );
        (tracksData.items || []).forEach((entry) => {
          if (out.length >= MAX_TRACKS) return;
          const track = entry && entry.track;
          if (!track || !track.id) return;
          out.push({
            id: 'spotify_' + track.id + '_' + out.length,
            title: track.name || 'Без названия',
            artist: (track.artists || []).map((a) => a.name).join(', ') || 'Неизвестно',
            album: (track.album && track.album.name) || '',
            duration: track.duration_ms ? track.duration_ms / 1000 : 0,
            url: track.preview_url || null,
            image: (track.album && track.album.images && track.album.images[0] && track.album.images[0].url) || null,
            source: 'spotify'
          });
        });
      } catch (err) {
        // Skip playlist on error
      }
    }

    nextUrl = data.next || null;
  }

  if (!out.length) {
    throw new Error('Не удалось получить треки Spotify.');
  }
  return out;
}

ipcMain.handle('import-music', async (event, payload) => {
  const service = payload && payload.service;
  const token = payload && payload.token;

  if (!token) throw new Error('Токен не указан');

  let tracks = [];
  if (service === 'vk') tracks = await importVK(token);
  else if (service === 'yandex') tracks = await importYandex(token);
  else if (service === 'spotify') tracks = await importSpotify(token);
  else throw new Error('Неизвестный сервис: ' + service);

  return { tracks: tracks };
});
