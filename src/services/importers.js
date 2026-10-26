/**
 * Полноценный импорт медиатеки для настольного приложения.
 * Работает в main-процессе Electron, поэтому не ограничен CORS.
 *
 * Возвращает единый результат для всех сервисов:
 *   { tracks, collections, stats, warnings, account }
 */
'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');

const MAX_TRACKS = 20000;
const CONCURRENCY = 4;
const MAX_PAGES = 200;
const REQUEST_TIMEOUT = 30000;

const DEFAULT_HEADERS = {
  'User-Agent': 'Sonor/1.1 (Electron; +https://github.com/MyNameIsNikki/Sonor)',
  Accept: 'application/json, text/plain, */*'
};

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function requestRaw(targetUrl, options) {
  const opts = options || {};
  return new Promise(function (resolve, reject) {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      reject(new Error('Некорректный адрес запроса'));
      return;
    }

    const lib = parsed.protocol === 'http:' ? http : https;
    const body = opts.body;
    const headers = Object.assign({}, DEFAULT_HEADERS, opts.headers || {});
    if (body) headers['Content-Length'] = Buffer.byteLength(body);

    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        method: opts.method || 'GET',
        headers: headers
      },
      function (res) {
        const status = res.statusCode || 0;

        if ([301, 302, 303, 307, 308].indexOf(status) !== -1 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, targetUrl).toString();
          resolve(requestRaw(next, Object.assign({}, opts, { body: status === 303 ? undefined : body })));
          return;
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', function (chunk) { data += chunk; });
        res.on('end', function () {
          if (status >= 400) {
            const clean = data.replace(/\s+/g, ' ').slice(0, 240);
            reject(new Error('HTTP ' + status + ': ' + clean));
            return;
          }
          resolve(data);
        });
      }
    );

    req.setTimeout(REQUEST_TIMEOUT, function () {
      req.destroy(new Error('Превышено время ожидания ответа API'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getJson(targetUrl, headers) {
  const raw = await requestRaw(targetUrl, { headers: headers });
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('Некорректный ответ API: ' + raw.replace(/\s+/g, ' ').slice(0, 180));
  }
}

async function postFormJson(targetUrl, form, headers) {
  const body = form.toString();
  const raw = await requestRaw(targetUrl, {
    method: 'POST',
    body: body,
    headers: Object.assign(
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      headers || {}
    )
  });
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('Некорректный ответ API: ' + raw.replace(/\s+/g, ' ').slice(0, 180));
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        results[index] = { __error: err };
      }
    }
  }

  const runners = [];
  const count = Math.min(limit, items.length);
  for (let i = 0; i < count; i++) runners.push(run());
  await Promise.all(runners);
  return results;
}

function text(value, fallback) {
  if (value === undefined || value === null) return fallback || '';
  const s = String(value).trim();
  return s || (fallback || '');
}

function imageUrl(url) {
  if (!url) return null;
  let s = String(url);
  if (s.indexOf('//') === 0) s = 'https:' + s;
  if (s.indexOf('http://') === 0) s = 'https://' + s.slice(7);
  return s;
}

function yandexImage(url) {
  if (!url) return null;
  let s = String(url);
  if (s.indexOf('//') === 0) s = 'https:' + s;
  if (s.indexOf('http') !== 0) s = 'https://' + s;
  return s.replace(/%%/g, '400x400');
}

function yandexArtists(artists) {
  if (!Array.isArray(artists)) return '';
  return artists.map(function (a) { return a && a.name; }).filter(Boolean).join(', ');
}

/* ------------------------------------------------------------------ */
/* Result builder                                                      */
/* ------------------------------------------------------------------ */

function createBuilder(service, onProgress) {
  const trackMap = new Map();
  const collections = [];
  const collectionMap = new Map();
  const warnings = [];
  let truncated = false;

  function progress(phase, message) {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({
        service: service,
        phase: phase,
        message: message,
        loaded: trackMap.size,
        collections: collections.length
      });
    } catch (e) {
      /* progress is best-effort */
    }
  }

  function addTrack(track) {
    if (!track || !track.id) return null;
    if (!trackMap.has(track.id) && trackMap.size >= MAX_TRACKS) {
      truncated = true;
      return null;
    }
    if (!trackMap.has(track.id)) trackMap.set(track.id, track);
    else {
      const existing = trackMap.get(track.id);
      if (!existing.url && track.url) existing.url = track.url;
      if (!existing.image && track.image) existing.image = track.image;
      if (!existing.album && track.album) existing.album = track.album;
    }
    return trackMap.get(track.id);
  }

  function addCollection(data) {
    if (!data || !data.id || !data.trackIds || !data.trackIds.length) return;
    const unique = [];
    const seen = new Set();
    data.trackIds.forEach(function (id) {
      if (id && !seen.has(id)) {
        seen.add(id);
        unique.push(id);
      }
    });
    const existing = collectionMap.get(data.id);
    if (existing) {
      unique.forEach(function (id) {
        if (existing.trackIds.indexOf(id) === -1) existing.trackIds.push(id);
      });
      return;
    }
    const collection = {
      id: data.id,
      source: service,
      type: data.type || 'playlist',
      title: text(data.title, 'Без названия'),
      subtitle: text(data.subtitle, ''),
      image: imageUrl(data.image),
      trackIds: unique
    };
    collectionMap.set(collection.id, collection);
    collections.push(collection);
  }

  function warn(message) {
    if (!message) return;
    const s = String(message);
    if (warnings.length < 12 && warnings.indexOf(s) === -1) warnings.push(s);
  }

  function finish(account) {
    if (truncated) warn('Достигнут лимит ' + MAX_TRACKS + ' треков — импорт остановлен.');
    const stats = {
      tracks: trackMap.size,
      playlists: collections.filter(function (c) { return c.type === 'playlist'; }).length,
      albums: collections.filter(function (c) { return c.type === 'album'; }).length,
      liked: collections.filter(function (c) { return c.type === 'liked'; }).length
    };
    progress('done', 'Готово: ' + stats.tracks + ' треков');
    return {
      tracks: Array.from(trackMap.values()),
      collections: collections,
      stats: stats,
      warnings: warnings,
      account: account || null
    };
  }

  return {
    addTrack: addTrack,
    addCollection: addCollection,
    warn: warn,
    progress: progress,
    finish: finish,
    size: function () { return trackMap.size; }
  };
}

/* ------------------------------------------------------------------ */
/* VK Music                                                            */
/* ------------------------------------------------------------------ */

function vkApi(method, token, params) {
  const form = new URLSearchParams();
  form.set('access_token', token);
  form.set('v', '5.131');
  Object.keys(params || {}).forEach(function (key) {
    if (params[key] !== undefined && params[key] !== null) form.set(key, String(params[key]));
  });
  return getJson('https://api.vk.com/method/' + method + '?' + form.toString()).then(function (data) {
    if (data && data.error) {
      const err = new Error(data.error.error_msg || data.error.error_message || 'Ошибка VK API');
      err.code = data.error.error_code;
      throw err;
    }
    return data ? data.response : null;
  });
}

function vkTrackKey(item) {
  const owner = item.owner_id || item.album && item.album.owner_id || 0;
  return 'vk_' + owner + '_' + item.id;
}

function vkMapTrack(item, fallbackImage) {
  const album = item.album && item.album.title;
  return {
    id: vkTrackKey(item),
    externalId: String(item.id),
    title: text(item.title, 'Без названия'),
    artist: text(item.artist, 'Неизвестный исполнитель'),
    album: text(album, ''),
    duration: typeof item.duration === 'number' ? item.duration : 0,
    url: item.url || null,
    image: imageUrl(
      (item.album && item.album.thumb && (
        item.album.thumb.photo_600 || item.album.thumb.photo_300 || item.album.thumb.photo_270
      )) ||
      (item.thumb && (item.thumb.photo_600 || item.thumb.photo_300)) ||
      fallbackImage
    ),
    source: 'vk'
  };
}

async function importVKFull(token, builder) {
  builder.progress('library', 'Загружаем аудиозаписи VK…');

  const library = [];
  let offset = 0;
  let total = null;
  let pages = 0;

  while (pages < MAX_PAGES) {
    pages++;
    const response = await vkApi('audio.get', token, { count: 200, offset: offset });
    const items = Array.isArray(response) ? response : (response && response.items) || [];
    if (!items.length) break;
    items.forEach(function (item) {
      const track = builder.addTrack(vkMapTrack(item));
      if (track) library.push(track.id);
    });
    builder.progress('library', 'Аудиозаписи VK: ' + builder.size());
    if (builder.size() >= MAX_TRACKS) break;
    if (response && typeof response.count === 'number') total = response.count;
    offset += items.length;
    if (items.length < 200) break;
    if (total !== null && offset >= total) break;
  }

  if (library.length) {
    builder.addCollection({
      id: 'vk_library',
      type: 'library',
      title: 'Моя музыка',
      subtitle: 'Аудиозаписи VK',
      trackIds: library
    });
  }

  builder.progress('playlists', 'Загружаем плейлисты VK…');

  const playlists = [];
  offset = 0;
  pages = 0;
  try {
    while (pages < MAX_PAGES) {
      pages++;
      const response = await vkApi('audio.getPlaylists', token, { count: 100, offset: offset });
      const items = (response && response.items) || [];
      if (!items.length) break;
      items.forEach(function (p) { playlists.push(p); });
      offset += items.length;
      if (items.length < 100) break;
      if (response && response.count && offset >= response.count) break;
    }
  } catch (err) {
    builder.warn('Плейлисты VK: ' + err.message);
  }

  if (playlists.length) {
    const results = await mapLimit(playlists, CONCURRENCY, async function (playlist) {
      const ids = [];
      let pOffset = 0;
      let pPages = 0;
      const image = imageUrl(playlist.photo_600 || playlist.photo_300 || playlist.photo_270);
      while (pPages < MAX_PAGES) {
        pPages++;
        const response = await vkApi('audio.get', token, {
          owner_id: playlist.owner_id,
          album_id: playlist.id,
          access_key: playlist.access_key,
          count: 200,
          offset: pOffset
        });
        const items = (response && response.items) || [];
        items.forEach(function (item) {
          const track = builder.addTrack(vkMapTrack(item, image));
          if (track) ids.push(track.id);
          if (builder.size() >= MAX_TRACKS) return;
        });
        if (items.length < 200) break;
        pOffset += items.length;
        if (response && response.count && pOffset >= response.count) break;
        if (builder.size() >= MAX_TRACKS) break;
      }
      builder.progress('playlists', 'Плейлисты VK: ' + builder.size() + ' треков');
      if (!ids.length) return null;
      return {
        id: 'vk_playlist_' + text(playlist.owner_id, '0') + '_' + playlist.id,
        title: playlist.title,
        subtitle: playlist.count ? playlist.count + ' треков' : 'Плейлист VK',
        image: image,
        trackIds: ids
      };
    });

    results.forEach(function (collection) {
      if (collection) builder.addCollection(collection);
      else if (collection && collection.__error) builder.warn('Плейлист VK: ' + collection.__error.message);
    });

    results.forEach(function (r) {
      if (r && r.__error) builder.warn('Плейлист VK: ' + r.__error.message);
    });
  }

  if (!builder.size()) {
    throw new Error('VK не вернул ни одного трека. Проверьте токен и доступ к аудио.');
  }

  return builder.finish();
}

/* ------------------------------------------------------------------ */
/* Yandex Music                                                        */
/* ------------------------------------------------------------------ */

const YANDEX_API = 'https://api.music.yandex.net';

function yandexHeaders(token) {
  return { Authorization: 'OAuth ' + token };
}

async function yandexGet(pathname, token) {
  const data = await getJson(YANDEX_API + pathname, yandexHeaders(token));
  return data && Object.prototype.hasOwnProperty.call(data, 'result') ? data.result : data;
}

function yandexPlaylistImage(playlist) {
  if (!playlist) return null;
  if (playlist.ogImage) return yandexImage(playlist.ogImage);
  if (playlist.cover && playlist.cover.uri) return yandexImage(playlist.cover.uri);
  if (playlist.image) return yandexImage(playlist.image);
  return null;
}

function yandexMapTrack(track, fallbackAlbum) {
  if (!track || !track.id) return null;
  const albums = Array.isArray(track.albums) ? track.albums : [];
  const album = albums[0] || {};
  const cover = album.coverUri || track.coverUri;
  return {
    id: 'yandex_' + track.id,
    externalId: String(track.id),
    title: text(track.title || track.name, 'Без названия'),
    artist: text(yandexArtists(track.artists), 'Неизвестный исполнитель'),
    album: text(album.title, fallbackAlbum || ''),
    duration: track.durationMs
      ? Math.round(track.durationMs / 100) / 10
      : (typeof track.duration === 'number' ? track.duration : 0),
    url: null,
    image: yandexImage(cover),
    source: 'yandex'
  };
}

function yandexExtractTracks(container) {
  if (!container) return [];
  if (Array.isArray(container)) return container;
  if (Array.isArray(container.tracks)) return container.tracks;
  if (container.playlist && Array.isArray(container.playlist.tracks)) return container.playlist.tracks;
  return [];
}

async function yandexFetchTracksByIds(ids, token) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const form = new URLSearchParams();
    ids.slice(i, i + 100).forEach(function (id) { form.append('track-ids', String(id)); });
    try {
      const data = await postFormJson(YANDEX_API + '/tracks', form, yandexHeaders(token));
      const result = data && Object.prototype.hasOwnProperty.call(data, 'result') ? data.result : data;
      if (Array.isArray(result)) out.push.apply(out, result);
    } catch (err) {
      /* Batch may partially fail; keep going */
    }
  }
  return out;
}

async function importYandexFull(token, builder) {
  builder.progress('account', 'Проверяем аккаунт Яндекс Музыки…');

  let uid = null;
  let account = null;
  try {
    const status = await yandexGet('/account/status', token);
    uid = status && status.account && status.account.uid;
    account = {
      name: status && status.account && (status.account.displayName || status.account.login),
      id: uid
    };
  } catch (err) {
    throw new Error('Не удалось проверить токен Яндекс Музыки: ' + err.message);
  }

  if (!uid) throw new Error('Яндекс Музыка не вернула UID аккаунта.');

  builder.progress('playlists', 'Загружаем плейлисты Яндекс Музыки…');

  let playlists = [];
  try {
    const list = await yandexGet('/users/' + uid + '/playlists/list', token);
    playlists = Array.isArray(list) ? list : (list && (list.playlists || list.items)) || [];
  } catch (err) {
    builder.warn('Список плейлистов Яндекса: ' + err.message);
  }

  const playlistResults = await mapLimit(playlists, CONCURRENCY, async function (playlist) {
    const kind = playlist && playlist.kind;
    if (kind === undefined || kind === null) return null;
    const full = await yandexGet('/users/' + uid + '/playlists/' + kind, token);
    const source = (full && full.playlist) || full || playlist;
    const entries = yandexExtractTracks(source);
    const ids = [];
    const fallbackAlbum = text(playlist.title, '');
    entries.forEach(function (entry) {
      const track = entry && (entry.track || entry);
      const mapped = builder.addTrack(yandexMapTrack(track, fallbackAlbum));
      if (mapped) ids.push(mapped.id);
    });
    const playlistTracks = source && source.trackCount;
    return {
      id: 'yandex_playlist_' + text(playlist.owner && playlist.owner.uid, uid) + '_' + kind,
      title: text(playlist.title, 'Плейлист'),
      subtitle: (playlistTracks || ids.length) + ' треков',
      image: yandexPlaylistImage(source) || yandexPlaylistImage(playlist),
      trackIds: ids
    };
  });

  playlistResults.forEach(function (c) {
    if (c && c.__error) builder.warn('Плейлист Яндекса: ' + c.__error.message);
    else if (c) builder.addCollection(c);
  });
  builder.progress('playlists', 'Плейлисты Яндекса: ' + builder.size() + ' треков');

  /* --- Мне нравится --- */
  builder.progress('liked', 'Загружаем любимые треки…');
  try {
    const liked = await yandexGet('/users/' + uid + '/likes/tracks', token);
    const library = liked && (liked.library || liked);
    const shorts = (library && (library.tracks || library.items)) || [];
    const shortIds = shorts.map(function (s) { return s && (s.id || s.trackId || (s.track && s.track.id)); }).filter(Boolean);
    const fullTracks = shortIds.length ? await yandexFetchTracksByIds(shortIds, token) : [];
    const ids = [];
    fullTracks.forEach(function (track) {
      const mapped = builder.addTrack(yandexMapTrack(track));
      if (mapped) ids.push(mapped.id);
    });
    if (ids.length) {
      builder.addCollection({
        id: 'yandex_liked',
        type: 'liked',
        title: 'Мне нравится',
        subtitle: 'Любимые треки Яндекс Музыки',
        image: fullTracks[0] && yandexImage(fullTracks[0].coverUri),
        trackIds: ids
      });
    }
  } catch (err) {
    builder.warn('Любимые треки Яндекса: ' + err.message);
  }

  /* --- Любимые альбомы --- */
  builder.progress('albums', 'Загружаем альбомы Яндекс Музыки…');
  try {
    const likes = await yandexGet('/users/' + uid + '/likes/albums?rich=true', token);
    const library = likes && (likes.library || likes);
    let albumLikes = (library && (library.albums || library.items)) || (Array.isArray(likes) ? likes : []);
    albumLikes = albumLikes.map(function (item) { return item && (item.album || item); }).filter(Boolean);
    if (albumLikes.length > 500) albumLikes = albumLikes.slice(0, 500);

    const albumResults = await mapLimit(albumLikes, CONCURRENCY, async function (album) {
      if (!album.id) return null;
      const full = await yandexGet('/albums/' + album.id + '/with-tracks', token);
      const data = (full && full.album) || full || album;
      const volumes = data && data.volumes;
      const entries = [];
      if (Array.isArray(volumes)) {
        volumes.forEach(function (volume) {
          if (Array.isArray(volume)) entries.push.apply(entries, volume);
        });
      }
      if (!entries.length) entries.push.apply(entries, yandexExtractTracks(data));
      const ids = [];
      entries.forEach(function (entry) {
        const track = entry && (entry.track || entry);
        const mapped = builder.addTrack(yandexMapTrack(track, data.title));
        if (mapped) ids.push(mapped.id);
      });
      return {
        id: 'yandex_album_' + album.id,
        type: 'album',
        title: text(album.title || data.title, 'Альбом'),
        subtitle: text(yandexArtists(album.artists || data.artists), '') ||
          (album.year ? String(album.year) : 'Альбом'),
        image: yandexImage(album.coverUri || data.coverUri),
        trackIds: ids
      };
    });

    albumResults.forEach(function (c) {
      if (c && c.__error) builder.warn('Альбом Яндекса: ' + c.__error.message);
      else if (c) builder.addCollection(c);
    });
  } catch (err) {
    builder.warn('Альбомы Яндекса: ' + err.message);
  }

  if (!builder.size()) {
    throw new Error('Яндекс Музыка не вернула треки. Проверьте токен и подписку.');
  }

  return builder.finish(account);
}

async function resolveYandexStream(trackId, token) {
  const data = await getJson(
    YANDEX_API + '/tracks/' + encodeURIComponent(trackId) + '/download-info',
    yandexHeaders(token)
  );
  const result = data && Object.prototype.hasOwnProperty.call(data, 'result') ? data.result : data;
  const infos = Array.isArray(result) ? result : [];
  if (!infos.length) throw new Error('Яндекс не вернул ссылку на трек');

  const mp3 = infos.filter(function (i) {
    return i && i.codec === 'mp3' && i.downloadInfoUrl;
  });
  const pool = mp3.length ? mp3 : infos.filter(function (i) { return i && i.downloadInfoUrl; });
  if (!pool.length) throw new Error('Ссылка на трек недоступна');

  pool.sort(function (a, b) { return (b.bitrateInKbps || 0) - (a.bitrateInKbps || 0); });
  const infoUrl = pool[0].downloadInfoUrl;

  const xml = await requestRaw(infoUrl, { headers: { Accept: '*/*' } });
  function tag(name) {
    const match = xml.match(new RegExp('<' + name + '>([^<]*)</' + name + '>'));
    return match ? match[1] : '';
  }
  const host = tag('host');
  const pathValue = tag('path');
  const ts = tag('ts');
  const s = tag('s');
  if (!host || !pathValue || !ts || !s) throw new Error('Не удалось разобрать ссылку Яндекса');

  const sign = crypto
    .createHash('md5')
    .update('XGRlBW9FXlekgbPrRHuSiA' + pathValue.replace(/^\//, '') + s)
    .digest('hex');

  return 'https://' + host + '/get-mp3/' + sign + '/' + ts + pathValue;
}

/* ------------------------------------------------------------------ */
/* Spotify                                                             */
/* ------------------------------------------------------------------ */

const SPOTIFY_API = 'https://api.spotify.com/v1';

function spotifyHeaders(token) {
  return { Authorization: 'Bearer ' + token };
}

async function spotifyGet(url, token) {
  const data = await getJson(url, spotifyHeaders(token));
  if (data && data.error) {
    throw new Error(data.error.message || 'Ошибка Spotify API');
  }
  return data;
}

async function spotifyPaged(url, token, onPage) {
  let next = url;
  let pages = 0;
  const all = [];
  while (next && pages < MAX_PAGES) {
    pages++;
    const data = await spotifyGet(next, token);
    const items = data.items || [];
    Array.prototype.push.apply(all, items);
    if (typeof onPage === 'function') onPage(items, data);
    next = data.next || null;
  }
  return all;
}

function spotifyImage(images) {
  if (!Array.isArray(images) || !images.length) return null;
  const sorted = images.slice().sort(function (a, b) { return (b.width || 0) - (a.width || 0); });
  return imageUrl(sorted[0] && sorted[0].url);
}

function spotifyMapTrack(track, fallbackAlbum) {
  if (!track || !track.id || track.is_local) return null;
  return {
    id: 'spotify_' + track.id,
    externalId: String(track.id),
    title: text(track.name, 'Без названия'),
    artist: text((track.artists || []).map(function (a) { return a.name; }).join(', '), 'Неизвестный исполнитель'),
    album: text(track.album && track.album.name, fallbackAlbum || ''),
    duration: track.duration_ms ? Math.round(track.duration_ms / 1000) : 0,
    url: track.preview_url || null,
    image: spotifyImage(track.album && track.album.images),
    source: 'spotify'
  };
}

function spotifyEntryTrack(entry) {
  if (!entry) return null;
  return entry.track || entry.item || null;
}

async function importSpotifyFull(token, builder) {
  builder.progress('account', 'Проверяем аккаунт Spotify…');

  let account = null;
  try {
    const me = await spotifyGet(SPOTIFY_API + '/me', token);
    account = { name: me.display_name || me.id, id: me.id };
  } catch (err) {
    throw new Error('Не удалось проверить токен Spotify: ' + err.message);
  }

  builder.progress('playlists', 'Загружаем плейлисты Spotify…');

  let playlists = [];
  try {
    playlists = await spotifyPaged(SPOTIFY_API + '/me/playlists?limit=50', token);
  } catch (err) {
    builder.warn('Плейлисты Spotify: ' + err.message);
  }

  const playlistResults = await mapLimit(playlists, CONCURRENCY, async function (playlist) {
    if (!playlist || !playlist.id) return null;
    const entries = await spotifyPaged(
      SPOTIFY_API + '/playlists/' + playlist.id + '/tracks?limit=100',
      token
    );
    const ids = [];
    entries.forEach(function (entry) {
      const mapped = builder.addTrack(spotifyMapTrack(spotifyEntryTrack(entry), playlist.name));
      if (mapped) ids.push(mapped.id);
    });
    builder.progress('playlists', 'Плейлисты Spotify: ' + builder.size() + ' треков');
    return {
      id: 'spotify_playlist_' + playlist.id,
      type: 'playlist',
      title: playlist.name,
      subtitle: text(playlist.owner && playlist.owner.display_name, '') ||
        ((playlist.tracks && playlist.tracks.total) || ids.length) + ' треков',
      image: spotifyImage(playlist.images),
      trackIds: ids
    };
  });

  playlistResults.forEach(function (c) {
    if (c && c.__error) builder.warn('Плейлист Spotify: ' + c.__error.message);
    else if (c) builder.addCollection(c);
  });

  /* --- Любимые треки --- */
  builder.progress('liked', 'Загружаем любимые треки Spotify…');
  try {
    const entries = await spotifyPaged(SPOTIFY_API + '/me/tracks?limit=50', token);
    const ids = [];
    entries.forEach(function (entry) {
      const mapped = builder.addTrack(spotifyMapTrack(spotifyEntryTrack(entry)));
      if (mapped) ids.push(mapped.id);
    });
    if (ids.length) {
      const first = spotifyEntryTrack(entries[0]);
      builder.addCollection({
        id: 'spotify_liked',
        type: 'liked',
        title: 'Мне нравится',
        subtitle: 'Любимые треки Spotify',
        image: spotifyImage(first && first.album && first.album.images),
        trackIds: ids
      });
    }
  } catch (err) {
    builder.warn('Любимые треки Spotify: ' + err.message);
  }

  /* --- Сохранённые альбомы --- */
  builder.progress('albums', 'Загружаем альбомы Spotify…');
  try {
    const saved = await spotifyPaged(SPOTIFY_API + '/me/albums?limit=50', token);
    const albums = saved
      .map(function (entry) { return entry && entry.album; })
      .filter(function (a) { return a && a.id; });
    if (albums.length > 500) albums = albums.slice(0, 500);

    const albumResults = await mapLimit(albums, CONCURRENCY, async function (album) {
      const entries = await spotifyPaged(
        SPOTIFY_API + '/albums/' + album.id + '/tracks?limit=50',
        token
      );
      const ids = [];
      entries.forEach(function (track) {
        const mapped = builder.addTrack(spotifyMapTrack(track, album.name));
        if (mapped) ids.push(mapped.id);
      });
      return {
        id: 'spotify_album_' + album.id,
        type: 'album',
        title: album.name,
        subtitle: text((album.artists || []).map(function (a) { return a.name; }).join(', '), '') ||
          (album.release_date ? album.release_date.slice(0, 4) : 'Альбом'),
        image: spotifyImage(album.images),
        trackIds: ids
      };
    });

    albumResults.forEach(function (c) {
      if (c && c.__error) builder.warn('Альбом Spotify: ' + c.__error.message);
      else if (c) builder.addCollection(c);
    });
  } catch (err) {
    builder.warn('Альбомы Spotify: ' + err.message);
  }

  if (!builder.size()) {
    throw new Error('Spotify не вернул треки. Проверьте токен и область доступа.');
  }

  return builder.finish(account);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

async function importService(service, token, onProgress) {
  if (!token) throw new Error('Токен не указан');
  const builder = createBuilder(service, onProgress);

  if (service === 'vk') return importVKFull(token, builder);
  if (service === 'yandex') return importYandexFull(token, builder);
  if (service === 'spotify') return importSpotifyFull(token, builder);
  throw new Error('Неизвестный сервис: ' + service);
}

module.exports = {
  importService: importService,
  resolveYandexStream: resolveYandexStream,
  MAX_TRACKS: MAX_TRACKS
};
