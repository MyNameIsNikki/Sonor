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
  if (!token) return {};
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
/* Public links (no account token)                                     */
/* ------------------------------------------------------------------ */

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)(?:$|\?)/i;

function splitArtistTitle(value) {
  const s = text(value, '');
  const parts = s.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: 'Неизвестный исполнитель', title: s };
}

function nameFromUrl(value) {
  try {
    const parsed = new URL(value);
    let name = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
    name = decodeURIComponent(name).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_+]+/g, ' ');
    return splitArtistTitle(name);
  } catch (err) {
    return { artist: 'Неизвестный исполнитель', title: 'Аудиопоток' };
  }
}

function resolveUrl(value, base) {
  try {
    return new URL(value, base).toString();
  } catch (err) {
    return null;
  }
}

function addLinkTrack(builder, data, collectionId) {
  if (!data || (!data.url && !data.title)) return null;
  const mapped = builder.addTrack({
    id: data.id || ('link_' + crypto.createHash('sha1').update(data.url).digest('hex').slice(0, 16)),
    externalId: data.externalId || null,
    title: text(data.title, 'Без названия'),
    artist: text(data.artist, 'Неизвестный исполнитель'),
    album: text(data.album, ''),
    duration: Number(data.duration) || 0,
    url: data.url,
    image: data.image || null,
    source: 'link',
    provider: data.provider || 'link',
    public: data.public === true,
    origin: collectionId
  });
  return mapped;
}

function parseM3U(raw, baseUrl, builder) {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  let pending = null;
  const entries = [];

  lines.forEach(function (line) {
    const value = line.trim();
    if (!value || value.indexOf('#EXTM3U') === 0) return;
    if (value.indexOf('#EXTINF:') === 0) {
      const comma = value.indexOf(',');
      const meta = comma === -1 ? '' : value.slice(comma + 1);
      pending = { meta: meta };
      return;
    }
    if (value.charAt(0) === '#') return;
    const url = resolveUrl(value, baseUrl);
    if (!url) return;
    entries.push({ url: url, meta: pending ? pending.meta : '' });
    pending = null;
  });

  return entries;
}

function parsePLS(raw, baseUrl) {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  const files = {};
  const titles = {};
  lines.forEach(function (line) {
    let match = line.match(/^\s*File(\d+)\s*=\s*(.+)$/i);
    if (match) files[match[1]] = resolveUrl(match[2].trim(), baseUrl);
    match = line.match(/^\s*Title(\d+)\s*=\s*(.+)$/i);
    if (match) titles[match[1]] = match[2].trim();
  });
  return Object.keys(files)
    .filter(function (key) { return !!files[key]; })
    .map(function (key) { return { url: files[key], meta: titles[key] || '' }; });
}

function parseXSPF(raw, baseUrl) {
  const entries = [];
  const blocks = raw.match(/<track\b[\s\S]*?<\/track>/gi) || [];
  blocks.forEach(function (block) {
    const location = block.match(/<location[^>]*>([\s\S]*?)<\/location>/i);
    if (!location) return;
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const creator = block.match(/<creator[^>]*>([\s\S]*?)<\/creator>/i);
    const decoded = location[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    const url = resolveUrl(decoded, baseUrl);
    if (!url) return;
    const meta = [creator ? creator[1] : '', title ? title[1] : ''].filter(Boolean).join(' - ');
    entries.push({ url: url, meta: meta });
  });
  return entries;
}

async function importSpotifyPublicLink(link, builder) {
  const match = link.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?(playlist|album|track)\/([A-Za-z0-9]+)/);
  if (!match) throw new Error('Не удалось распознать ссылку Spotify');

  builder.progress('link', 'Читаем публичную страницу Spotify…');
  const kind = match[1];
  const id = match[2];
  const html = await requestRaw('https://open.spotify.com/embed/' + kind + '/' + id, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' }
  });

  const script = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!script) throw new Error('Spotify не вернул данные публичной страницы');

  let entity;
  try {
    const data = JSON.parse(script[1]);
    const pageProps = data && data.props && data.props.pageProps;
    if (pageProps && pageProps.status) {
      throw new Error(
        'Spotify недоступен в вашем регионе (код ' + pageProps.status + '). ' +
        'Попробуйте VPN или импорт с токеном.'
      );
    }
    entity = pageProps && pageProps.state &&
      pageProps.state.data && pageProps.state.data.entity;
  } catch (err) {
    if (err && err.message && err.message.indexOf('Spotify недоступен') === 0) throw err;
    throw new Error('Не удалось разобрать ответ Spotify');
  }
  if (!entity) throw new Error('Публичная страница Spotify пуста или недоступна');

  const list = Array.isArray(entity.trackList) && entity.trackList.length
    ? entity.trackList
    : [entity];
  const cover = entity.coverArt && entity.coverArt.sources && entity.coverArt.sources[0]
    ? entity.coverArt.sources[0].url
    : null;
  const collectionId = 'link_spotify_' + (entity.id || id);
  const trackIds = [];
  let withoutPreview = 0;

  list.forEach(function (item) {
    if (!item) return;
    const uri = item.uri || '';
    const trackId = uri.indexOf('spotify:track:') === 0
      ? uri.slice('spotify:track:'.length)
      : (item.uid || crypto.createHash('sha1').update(JSON.stringify(item)).digest('hex').slice(0, 16));
    const preview = item.audioPreview && item.audioPreview.url ? item.audioPreview.url : null;
    if (!preview) withoutPreview++;
    const added = addLinkTrack(builder, {
      id: 'link_spotify_' + trackId,
      externalId: trackId,
      title: item.title,
      artist: item.subtitle,
      album: entity.name || '',
      duration: item.duration ? Math.round(item.duration / 1000) : 0,
      url: preview,
      image: cover,
      provider: 'spotify'
    }, collectionId);
    if (added) trackIds.push(added.id);
  });

  if (!trackIds.length) throw new Error('В этой ссылке Spotify нет треков');
  if (withoutPreview) {
    builder.warn('Spotify: для ' + withoutPreview + ' треков нет 30-секундного превью.');
  }
  builder.addCollection({
    id: collectionId,
    type: kind === 'album' ? 'album' : 'playlist',
    title: text(entity.name || entity.title, 'Spotify'),
    subtitle: text(entity.subtitle || entity.owner || 'Публичная ссылка Spotify', ''),
    image: cover,
    trackIds: trackIds
  });
  return builder.finish(null);
}

async function importYandexPublicLink(link, builder) {
  builder.progress('link', 'Читаем публичную страницу Яндекс Музыки…');
  let result;
  let collectionType = 'playlist';
  let collectionId;
  let title;
  let subtitle;
  let image;

  const playlistMatch = link.match(/music\.yandex\.[a-z]+\/users\/([^/?#]+)\/playlists\/([0-9]+)/i);
  const albumMatch = link.match(/music\.yandex\.[a-z]+\/album\/([0-9]+)/i);
  const uuidMatch = link.match(/music\.yandex\.[a-z]+\/playlists\/([0-9a-f-]{20,})/i);

  if (playlistMatch) {
    const login = decodeURIComponent(playlistMatch[1]);
    const kind = playlistMatch[2];
    result = await yandexGet('/users/' + encodeURIComponent(login) + '/playlists/' + kind, null);
    collectionId = 'link_yandex_' + login + '_' + kind;
    title = result.title;
    subtitle = result.owner && (result.owner.name || result.owner.login);
    image = yandexPlaylistImage(result);
  } else if (uuidMatch) {
    result = await yandexGet('/playlists/' + encodeURIComponent(uuidMatch[1]), null);
    collectionId = 'link_yandex_' + uuidMatch[1];
    title = result.title;
    subtitle = result.owner && (result.owner.name || result.owner.login);
    image = yandexPlaylistImage(result);
  } else if (albumMatch) {
    const albumId = albumMatch[1];
    result = await yandexGet('/albums/' + encodeURIComponent(albumId) + '/with-tracks', null);
    collectionType = 'album';
    collectionId = 'link_yandex_album_' + albumId;
    title = result.title;
    subtitle = yandexArtists(result.artists);
    image = yandexImage(result.coverUri);
  } else {
    throw new Error('Поддерживаются ссылки на плейлист или альбом Яндекс Музыки');
  }

  if (!result) throw new Error('Яндекс Музыка не вернул данные по ссылке');
  const rawTracks = result.volumes
    ? result.volumes.reduce(function (all, volume) { return all.concat(volume || []); }, [])
    : yandexExtractTracks(result);
  const trackIds = [];

  rawTracks.forEach(function (entry) {
    const track = entry && entry.track ? entry.track : entry;
    const mapped = yandexMapTrack(track, title);
    if (!mapped) return;
    const added = addLinkTrack(builder, {
      id: 'link_' + mapped.id,
      externalId: mapped.externalId,
      title: mapped.title,
      artist: mapped.artist,
      album: mapped.album,
      duration: mapped.duration,
      url: null,
      image: mapped.image,
      provider: 'yandex',
      public: true
    }, collectionId);
    if (added) trackIds.push(added.id);
  });

  if (!trackIds.length) throw new Error('В этой ссылке Яндекс Музыки нет треков');
  builder.addCollection({
    id: collectionId,
    type: collectionType,
    title: text(title, 'Яндекс Музыка'),
    subtitle: text(subtitle, 'Публичная ссылка'),
    image: image,
    trackIds: trackIds
  });
  return builder.finish(null);
}

async function importListLink(link, builder) {
  builder.progress('link', 'Загружаем список треков…');
  const raw = await requestRaw(link);
  let entries = [];
  let kind = 'playlist';
  if (/^\s*#EXTM3U/i.test(raw) || /\.m3u8?(?:$|\?)/i.test(link)) entries = parseM3U(raw, link, builder);
  else if (/^\s*\[playlist\]/i.test(raw) || /\.pls(?:$|\?)/i.test(link)) entries = parsePLS(raw, link);
  else if (/<playlist\b/i.test(raw) || /\.xspf(?:$|\?)/i.test(link)) entries = parseXSPF(raw, link);
  else throw new Error('Не удалось распознать формат списка (поддерживаются M3U, PLS и XSPF)');

  const collectionId = 'link_list_' + crypto.createHash('sha1').update(link).digest('hex').slice(0, 16);
  const trackIds = [];
  entries.forEach(function (entry) {
    const meta = splitArtistTitle(entry.meta);
    const fallback = nameFromUrl(entry.url);
    const added = addLinkTrack(builder, {
      title: meta.title || fallback.title,
      artist: meta.artist || fallback.artist,
      album: '',
      duration: 0,
      url: entry.url,
      provider: 'link'
    }, collectionId);
    if (added) trackIds.push(added.id);
  });

  if (!trackIds.length) throw new Error('В списке не найдено ни одного трека');
  let title = 'Плейлист по ссылке';
  try {
    title = decodeURIComponent(new URL(link).pathname.split('/').filter(Boolean).pop() || title);
  } catch (err) { /* keep default */ }
  builder.addCollection({
    id: collectionId,
    type: kind,
    title: title,
    subtitle: 'Импортировано по ссылке',
    image: null,
    trackIds: trackIds
  });
  return builder.finish(null);
}

function importDirectAudio(link, builder) {
  const meta = nameFromUrl(link);
  const collectionId = 'link_audio_' + crypto.createHash('sha1').update(link).digest('hex').slice(0, 16);
  const added = addLinkTrack(builder, {
    title: meta.title,
    artist: meta.artist,
    album: '',
    duration: 0,
    url: link,
    provider: 'link'
  }, collectionId);
  if (!added) throw new Error('Не удалось добавить аудиоссылку');
  builder.addCollection({
    id: collectionId,
    type: 'playlist',
    title: meta.title,
    subtitle: 'Аудиоссылка',
    image: null,
    trackIds: [added.id]
  });
  return builder.finish(null);
}

async function importPublicLink(link, onProgress) {
  const value = text(link, '');
  if (!/^https?:\/\//i.test(value)) throw new Error('Вставьте ссылку, начинающуюся с http:// или https://');

  const builder = createBuilder('link', onProgress);

  if (/open\.spotify\.com\//i.test(value)) return importSpotifyPublicLink(value, builder);
  if (/music\.yandex\.[a-z]+\//i.test(value)) return importYandexPublicLink(value, builder);
  if (/vk\.com\/|vk\.ru\//i.test(value)) {
    throw new Error('Публичные ссылки VK Музыки требуют токен. Используйте импорт VK с токеном.');
  }
  if (/\.(m3u8?|pls|xspf)(?:$|\?)/i.test(value)) return importListLink(value, builder);
  if (AUDIO_EXT.test(value)) return importDirectAudio(value, builder);
  throw new Error('Поддерживаются ссылки Spotify, Яндекс Музыки, M3U/PLS/XSPF и прямые аудиоссылки.');
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
  importPublicLink: importPublicLink,
  resolveYandexStream: resolveYandexStream,
  MAX_TRACKS: MAX_TRACKS
};
