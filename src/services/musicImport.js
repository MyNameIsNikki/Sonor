// Полноценный импорт медиатеки для мобильного приложения.
// Повторяет логику настольной версии: вся музыка, плейлисты, любимые треки и альбомы.
// Возвращает { tracks, collections, stats, warnings, account }.
import md5 from 'blueimp-md5';

const MAX_TRACKS = 20000;
const MAX_PAGES = 200;
const CONCURRENCY = 4;
const REQUEST_TIMEOUT = 30000;

const YANDEX_API = 'https://api.music.yandex.net';
const SPOTIFY_API = 'https://api.spotify.com/v1';

const SOURCE_NAMES = {
  vk: 'VK',
  yandex: 'Яндекс',
  spotify: 'Spotify'
};

function buildQuery(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

async function requestText(url, options = {}) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT) : null;
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller ? controller.signal : undefined,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Sonor/1.1 (Expo)',
        ...(options.headers || {})
      }
    });
    const body = await response.text();
    if (!response.ok) {
      const clean = body.replace(/\s+/g, ' ').slice(0, 240);
      throw new Error(`HTTP ${response.status}: ${clean}`);
    }
    return body;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getJson(url, headers) {
  const raw = await requestText(url, { headers });
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Некорректный ответ API: ${raw.replace(/\s+/g, ' ').slice(0, 180)}`);
  }
}

async function postFormJson(url, form, headers) {
  const raw = await requestText(url, {
    method: 'POST',
    body: form,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(headers || {})
    }
  });
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Некорректный ответ API: ${raw.replace(/\s+/g, ' ').slice(0, 180)}`);
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
      } catch (error) {
        results[index] = { __error: error };
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
  const result = String(value).trim();
  return result || fallback || '';
}

function imageUrl(url) {
  if (!url) return null;
  let result = String(url);
  if (result.indexOf('//') === 0) result = `https:${result}`;
  if (result.indexOf('http://') === 0) result = `https://${result.slice(7)}`;
  return result;
}

function yandexImage(url) {
  if (!url) return null;
  let result = String(url);
  if (result.indexOf('//') === 0) result = `https:${result}`;
  if (result.indexOf('http') !== 0) result = `https://${result}`;
  return result.replace(/%%/g, '400x400');
}

function yandexArtists(artists) {
  if (!Array.isArray(artists)) return '';
  return artists.map((artist) => artist && artist.name).filter(Boolean).join(', ');
}

function createBuilder(onProgress) {
  const trackMap = new Map();
  const collections = [];
  const collectionMap = new Map();
  const warnings = [];
  let truncated = false;

  function progress(phase, message, service) {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({
        service,
        phase,
        message,
        loaded: trackMap.size,
        collections: collections.length
      });
    } catch (error) {
      // progress is best-effort
    }
  }

  function addTrack(track) {
    if (!track || !track.id) return null;
    if (!trackMap.has(track.id) && trackMap.size >= MAX_TRACKS) {
      truncated = true;
      return null;
    }
    if (!trackMap.has(track.id)) {
      trackMap.set(track.id, track);
    } else {
      const existing = trackMap.get(track.id);
      if (!existing.url && track.url) existing.url = track.url;
      if (!existing.image && track.image) existing.image = track.image;
      if (!existing.album && track.album) existing.album = track.album;
    }
    return trackMap.get(track.id);
  }

  function addCollection(data, service) {
    if (!data || !data.id || !data.trackIds || !data.trackIds.length) return;
    const unique = [];
    const seen = new Set();
    data.trackIds.forEach((id) => {
      if (id && !seen.has(id)) {
        seen.add(id);
        unique.push(id);
      }
    });
    const existing = collectionMap.get(data.id);
    if (existing) {
      unique.forEach((id) => {
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
    const value = String(message);
    if (warnings.length < 12 && warnings.indexOf(value) === -1) warnings.push(value);
  }

  function finish(service, account) {
    if (truncated) warn(`Достигнут лимит ${MAX_TRACKS} треков — импорт остановлен.`);
    const stats = {
      tracks: trackMap.size,
      playlists: collections.filter((collection) => collection.type === 'playlist').length,
      albums: collections.filter((collection) => collection.type === 'album').length,
      liked: collections.filter((collection) => collection.type === 'liked').length
    };
    progress('done', `Готово: ${stats.tracks} треков`, service);
    return {
      tracks: Array.from(trackMap.values()),
      collections,
      stats,
      warnings,
      account: account || null
    };
  }

  return {
    addTrack,
    addCollection,
    warn,
    progress,
    finish,
    size: () => trackMap.size
  };
}

/* ------------------------------------------------------------------ */
/* VK                                                                  */
/* ------------------------------------------------------------------ */

function vkApi(method, token, params) {
  const query = buildQuery({ access_token: token, v: '5.131', ...(params || {}) });
  return getJson(`https://api.vk.com/method/${method}?${query}`).then((data) => {
    if (data && data.error) {
      const error = new Error(data.error.error_msg || data.error.error_message || 'Ошибка VK API');
      error.code = data.error.error_code;
      throw error;
    }
    return data ? data.response : null;
  });
}

function vkTrackKey(item) {
  const owner = item.owner_id || (item.album && item.album.owner_id) || 0;
  return `vk_${owner}_${item.id}`;
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
      (item.album &&
        item.album.thumb &&
        (item.album.thumb.photo_600 || item.album.thumb.photo_300 || item.album.thumb.photo_270)) ||
        (item.thumb && (item.thumb.photo_600 || item.thumb.photo_300)) ||
        fallbackImage
    ),
    source: 'vk'
  };
}

async function importVKFull(token, builder, onProgress) {
  builder.progress('library', 'Загружаем аудиозаписи VK…', 'vk');

  const library = [];
  let offset = 0;
  let total = null;
  let pages = 0;

  while (pages < MAX_PAGES) {
    pages++;
    const response = await vkApi('audio.get', token, { count: 200, offset });
    const items = Array.isArray(response) ? response : (response && response.items) || [];
    if (!items.length) break;
    items.forEach((item) => {
      const track = builder.addTrack(vkMapTrack(item));
      if (track) library.push(track.id);
    });
    builder.progress('library', `Аудиозаписи VK: ${builder.size()}`, 'vk');
    if (builder.size() >= MAX_TRACKS) break;
    if (response && typeof response.count === 'number') total = response.count;
    offset += items.length;
    if (items.length < 200) break;
    if (total !== null && offset >= total) break;
  }

  if (library.length) {
    builder.addCollection(
      {
        id: 'vk_library',
        type: 'library',
        title: 'Моя музыка',
        subtitle: 'Аудиозаписи VK',
        trackIds: library
      },
      'vk'
    );
  }

  builder.progress('playlists', 'Загружаем плейлисты VK…', 'vk');

  const playlists = [];
  offset = 0;
  pages = 0;
  try {
    while (pages < MAX_PAGES) {
      pages++;
      const response = await vkApi('audio.getPlaylists', token, { count: 100, offset });
      const items = (response && response.items) || [];
      if (!items.length) break;
      items.forEach((playlist) => playlists.push(playlist));
      offset += items.length;
      if (items.length < 100) break;
      if (response && response.count && offset >= response.count) break;
    }
  } catch (error) {
    builder.warn(`Плейлисты VK: ${error.message}`);
  }

  if (playlists.length) {
    const results = await mapLimit(playlists, CONCURRENCY, async (playlist) => {
      const ids = [];
      let playlistOffset = 0;
      let playlistPages = 0;
      const image = imageUrl(playlist.photo_600 || playlist.photo_300 || playlist.photo_270);
      while (playlistPages < MAX_PAGES) {
        playlistPages++;
        const response = await vkApi('audio.get', token, {
          owner_id: playlist.owner_id,
          album_id: playlist.id,
          access_key: playlist.access_key,
          count: 200,
          offset: playlistOffset
        });
        const items = (response && response.items) || [];
        items.forEach((item) => {
          if (builder.size() >= MAX_TRACKS) return;
          const track = builder.addTrack(vkMapTrack(item, image));
          if (track) ids.push(track.id);
        });
        if (items.length < 200) break;
        playlistOffset += items.length;
        if (response && response.count && playlistOffset >= response.count) break;
        if (builder.size() >= MAX_TRACKS) break;
      }
      builder.progress('playlists', `Плейлисты VK: ${builder.size()} треков`, 'vk');
      if (!ids.length) return null;
      return {
        id: `vk_playlist_${text(playlist.owner_id, '0')}_${playlist.id}`,
        title: playlist.title,
        subtitle: playlist.count ? `${playlist.count} треков` : 'Плейлист VK',
        image,
        trackIds: ids
      };
    });

    results.forEach((collection) => {
      if (!collection) return;
      if (collection.__error) builder.warn(`Плейлист VK: ${collection.__error.message}`);
      else builder.addCollection(collection, 'vk');
    });
  }

  if (!builder.size()) {
    throw new Error('VK не вернул ни одного трека. Проверьте токен и доступ к аудио.');
  }

  return builder.finish('vk');
}

/* ------------------------------------------------------------------ */
/* Яндекс Музыка                                                       */
/* ------------------------------------------------------------------ */

function yandexHeaders(token) {
  if (!token) return {};
  return { Authorization: `OAuth ${token}` };
}

async function yandexGet(pathname, token) {
  const data = await getJson(`${YANDEX_API}${pathname}`, yandexHeaders(token));
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
    id: `yandex_${track.id}`,
    externalId: String(track.id),
    title: text(track.title || track.name, 'Без названия'),
    artist: text(yandexArtists(track.artists), 'Неизвестный исполнитель'),
    album: text(album.title, fallbackAlbum || ''),
    duration: track.durationMs
      ? Math.round(track.durationMs / 100) / 10
      : typeof track.duration === 'number'
        ? track.duration
        : 0,
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
    const form = ids
      .slice(i, i + 100)
      .map((id) => `track-ids=${encodeURIComponent(String(id))}`)
      .join('&');
    try {
      const data = await postFormJson(`${YANDEX_API}/tracks`, form, yandexHeaders(token));
      const result = data && Object.prototype.hasOwnProperty.call(data, 'result') ? data.result : data;
      if (Array.isArray(result)) out.push(...result);
    } catch (error) {
      // Одна неудачная пачка не должна ломать весь импорт.
    }
  }
  return out;
}

async function importYandexFull(token, builder) {
  builder.progress('account', 'Проверяем аккаунт Яндекс Музыки…', 'yandex');

  let uid = null;
  let account = null;
  try {
    const status = await yandexGet('/account/status', token);
    uid = status && status.account && status.account.uid;
    account = {
      name: status && status.account && (status.account.displayName || status.account.login),
      id: uid
    };
  } catch (error) {
    throw new Error(`Не удалось проверить токен Яндекс Музыки: ${error.message}`);
  }

  if (!uid) throw new Error('Яндекс Музыка не вернула UID аккаунта.');

  builder.progress('playlists', 'Загружаем плейлисты Яндекс Музыки…', 'yandex');

  let playlists = [];
  try {
    const list = await yandexGet(`/users/${uid}/playlists/list`, token);
    playlists = Array.isArray(list) ? list : (list && (list.playlists || list.items)) || [];
  } catch (error) {
    builder.warn(`Список плейлистов Яндекса: ${error.message}`);
  }

  const playlistResults = await mapLimit(playlists, CONCURRENCY, async (playlist) => {
    const kind = playlist && playlist.kind;
    if (kind === undefined || kind === null) return null;
    const full = await yandexGet(`/users/${uid}/playlists/${kind}`, token);
    const source = (full && full.playlist) || full || playlist;
    const entries = yandexExtractTracks(source);
    const ids = [];
    const fallbackAlbum = text(playlist.title, '');
    entries.forEach((entry) => {
      const track = entry && (entry.track || entry);
      const mapped = builder.addTrack(yandexMapTrack(track, fallbackAlbum));
      if (mapped) ids.push(mapped.id);
    });
    const playlistTracks = source && source.trackCount;
    return {
      id: `yandex_playlist_${text(playlist.owner && playlist.owner.uid, uid)}_${kind}`,
      type: 'playlist',
      title: text(playlist.title, 'Плейлист'),
      subtitle: `${playlistTracks || ids.length} треков`,
      image: yandexPlaylistImage(source) || yandexPlaylistImage(playlist),
      trackIds: ids
    };
  });

  playlistResults.forEach((collection) => {
    if (!collection) return;
    if (collection.__error) builder.warn(`Плейлист Яндекса: ${collection.__error.message}`);
    else builder.addCollection(collection, 'yandex');
  });
  builder.progress('playlists', `Плейлисты Яндекса: ${builder.size()} треков`, 'yandex');

  builder.progress('liked', 'Загружаем любимые треки…', 'yandex');
  try {
    const liked = await yandexGet(`/users/${uid}/likes/tracks`, token);
    const library = liked && (liked.library || liked);
    const shorts = (library && (library.tracks || library.items)) || [];
    const shortIds = shorts
      .map((short) => short && (short.id || short.trackId || (short.track && short.track.id)))
      .filter(Boolean);
    const fullTracks = shortIds.length ? await yandexFetchTracksByIds(shortIds, token) : [];
    const ids = [];
    fullTracks.forEach((track) => {
      const mapped = builder.addTrack(yandexMapTrack(track));
      if (mapped) ids.push(mapped.id);
    });
    if (ids.length) {
      builder.addCollection(
        {
          id: 'yandex_liked',
          type: 'liked',
          title: 'Мне нравится',
          subtitle: 'Любимые треки Яндекс Музыки',
          image: fullTracks[0] && yandexImage(fullTracks[0].coverUri),
          trackIds: ids
        },
        'yandex'
      );
    }
  } catch (error) {
    builder.warn(`Любимые треки Яндекса: ${error.message}`);
  }

  builder.progress('albums', 'Загружаем альбомы Яндекс Музыки…', 'yandex');
  try {
    const likes = await yandexGet(`/users/${uid}/likes/albums?rich=true`, token);
    const library = likes && (likes.library || likes);
    let albumLikes = (library && (library.albums || library.items)) || (Array.isArray(likes) ? likes : []);
    albumLikes = albumLikes.map((item) => item && (item.album || item)).filter(Boolean);
    if (albumLikes.length > 500) albumLikes = albumLikes.slice(0, 500);

    const albumResults = await mapLimit(albumLikes, CONCURRENCY, async (album) => {
      if (!album.id) return null;
      const full = await yandexGet(`/albums/${album.id}/with-tracks`, token);
      const data = (full && full.album) || full || album;
      const entries = [];
      if (Array.isArray(data && data.volumes)) {
        data.volumes.forEach((volume) => {
          if (Array.isArray(volume)) entries.push(...volume);
        });
      }
      if (!entries.length) entries.push(...yandexExtractTracks(data));
      const ids = [];
      entries.forEach((entry) => {
        const track = entry && (entry.track || entry);
        const mapped = builder.addTrack(yandexMapTrack(track, data.title));
        if (mapped) ids.push(mapped.id);
      });
      return {
        id: `yandex_album_${album.id}`,
        type: 'album',
        title: text(album.title || data.title, 'Альбом'),
        subtitle:
          text(yandexArtists(album.artists || data.artists), '') ||
          (album.year ? String(album.year) : 'Альбом'),
        image: yandexImage(album.coverUri || data.coverUri),
        trackIds: ids
      };
    });

    albumResults.forEach((collection) => {
      if (!collection) return;
      if (collection.__error) builder.warn(`Альбом Яндекса: ${collection.__error.message}`);
      else builder.addCollection(collection, 'yandex');
    });
  } catch (error) {
    builder.warn(`Альбомы Яндекса: ${error.message}`);
  }

  if (!builder.size()) {
    throw new Error('Яндекс Музыка не вернула треки. Проверьте токен и подписку.');
  }

  return builder.finish('yandex', account);
}

function xmlTag(xml, name) {
  const match = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return match ? match[1] : '';
}

export async function resolveYandexStream(trackId, token) {
  const data = await getJson(
    `${YANDEX_API}/tracks/${encodeURIComponent(trackId)}/download-info`,
    yandexHeaders(token)
  );
  const result = data && Object.prototype.hasOwnProperty.call(data, 'result') ? data.result : data;
  const infos = Array.isArray(result) ? result : [];
  if (!infos.length) throw new Error('Яндекс не вернул ссылку на трек');

  const mp3 = infos.filter((info) => info && info.codec === 'mp3' && info.downloadInfoUrl);
  const pool = mp3.length ? mp3 : infos.filter((info) => info && info.downloadInfoUrl);
  if (!pool.length) throw new Error('Ссылка на трек недоступна');

  pool.sort((a, b) => (b.bitrateInKbps || 0) - (a.bitrateInKbps || 0));
  const infoUrl = pool[0].downloadInfoUrl;

  const xml = await requestText(infoUrl, { headers: { Accept: '*/*' } });
  const host = xmlTag(xml, 'host');
  const pathValue = xmlTag(xml, 'path');
  const ts = xmlTag(xml, 'ts');
  const s = xmlTag(xml, 's');
  if (!host || !pathValue || !ts || !s) throw new Error('Не удалось разобрать ссылку Яндекса');

  const sign = md5(`XGRlBW9FXlekgbPrRHuSiA${pathValue.replace(/^\//, '')}${s}`);
  return `https://${host}/get-mp3/${sign}/${ts}${pathValue}`;
}

/* ------------------------------------------------------------------ */
/* Spotify                                                             */
/* ------------------------------------------------------------------ */

function spotifyHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function spotifyGet(url, token) {
  const data = await getJson(url, spotifyHeaders(token));
  if (data && data.error) throw new Error(data.error.message || 'Ошибка Spotify API');
  return data;
}

async function spotifyPaged(url, token) {
  let next = url;
  let pages = 0;
  const all = [];
  while (next && pages < MAX_PAGES) {
    pages++;
    const data = await spotifyGet(next, token);
    const items = data.items || [];
    all.push(...items);
    next = data.next || null;
  }
  return all;
}

function spotifyImage(images) {
  if (!Array.isArray(images) || !images.length) return null;
  const sorted = images.slice().sort((a, b) => (b.width || 0) - (a.width || 0));
  return imageUrl(sorted[0] && sorted[0].url);
}

function spotifyMapTrack(track, fallbackAlbum) {
  if (!track || !track.id || track.is_local) return null;
  return {
    id: `spotify_${track.id}`,
    externalId: String(track.id),
    title: text(track.name, 'Без названия'),
    artist: text((track.artists || []).map((artist) => artist.name).join(', '), 'Неизвестный исполнитель'),
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
  builder.progress('account', 'Проверяем аккаунт Spotify…', 'spotify');

  let account = null;
  try {
    const me = await spotifyGet(`${SPOTIFY_API}/me`, token);
    account = { name: me.display_name || me.id, id: me.id };
  } catch (error) {
    throw new Error(`Не удалось проверить токен Spotify: ${error.message}`);
  }

  builder.progress('playlists', 'Загружаем плейлисты Spotify…', 'spotify');

  let playlists = [];
  try {
    playlists = await spotifyPaged(`${SPOTIFY_API}/me/playlists?limit=50`, token);
  } catch (error) {
    builder.warn(`Плейлисты Spotify: ${error.message}`);
  }

  const playlistResults = await mapLimit(playlists, CONCURRENCY, async (playlist) => {
    if (!playlist || !playlist.id) return null;
    const entries = await spotifyPaged(
      `${SPOTIFY_API}/playlists/${playlist.id}/tracks?limit=100`,
      token
    );
    const ids = [];
    entries.forEach((entry) => {
      const mapped = builder.addTrack(spotifyMapTrack(spotifyEntryTrack(entry), playlist.name));
      if (mapped) ids.push(mapped.id);
    });
    builder.progress('playlists', `Плейлисты Spotify: ${builder.size()} треков`, 'spotify');
    return {
      id: `spotify_playlist_${playlist.id}`,
      type: 'playlist',
      title: playlist.name,
      subtitle:
        text(playlist.owner && playlist.owner.display_name, '') ||
        `${(playlist.tracks && playlist.tracks.total) || ids.length} треков`,
      image: spotifyImage(playlist.images),
      trackIds: ids
    };
  });

  playlistResults.forEach((collection) => {
    if (!collection) return;
    if (collection.__error) builder.warn(`Плейлист Spotify: ${collection.__error.message}`);
    else builder.addCollection(collection, 'spotify');
  });

  builder.progress('liked', 'Загружаем любимые треки Spotify…', 'spotify');
  try {
    const entries = await spotifyPaged(`${SPOTIFY_API}/me/tracks?limit=50`, token);
    const ids = [];
    entries.forEach((entry) => {
      const mapped = builder.addTrack(spotifyMapTrack(spotifyEntryTrack(entry)));
      if (mapped) ids.push(mapped.id);
    });
    if (ids.length) {
      const first = spotifyEntryTrack(entries[0]);
      builder.addCollection(
        {
          id: 'spotify_liked',
          type: 'liked',
          title: 'Мне нравится',
          subtitle: 'Любимые треки Spotify',
          image: spotifyImage(first && first.album && first.album.images),
          trackIds: ids
        },
        'spotify'
      );
    }
  } catch (error) {
    builder.warn(`Любимые треки Spotify: ${error.message}`);
  }

  builder.progress('albums', 'Загружаем альбомы Spotify…', 'spotify');
  try {
    const saved = await spotifyPaged(`${SPOTIFY_API}/me/albums?limit=50`, token);
    let albums = saved
      .map((entry) => entry && entry.album)
      .filter((album) => album && album.id);
    if (albums.length > 500) albums = albums.slice(0, 500);

    const albumResults = await mapLimit(albums, CONCURRENCY, async (album) => {
      const entries = await spotifyPaged(`${SPOTIFY_API}/albums/${album.id}/tracks?limit=50`, token);
      const ids = [];
      entries.forEach((track) => {
        const mapped = builder.addTrack(spotifyMapTrack(track, album.name));
        if (mapped) ids.push(mapped.id);
      });
      return {
        id: `spotify_album_${album.id}`,
        type: 'album',
        title: album.name,
        subtitle:
          text((album.artists || []).map((artist) => artist.name).join(', '), '') ||
          (album.release_date ? album.release_date.slice(0, 4) : 'Альбом'),
        image: spotifyImage(album.images),
        trackIds: ids
      };
    });

    albumResults.forEach((collection) => {
      if (!collection) return;
      if (collection.__error) builder.warn(`Альбом Spotify: ${collection.__error.message}`);
      else builder.addCollection(collection, 'spotify');
    });
  } catch (error) {
    builder.warn(`Альбомы Spotify: ${error.message}`);
  }

  if (!builder.size()) {
    throw new Error('Spotify не вернул треки. Проверьте токен и область доступа.');
  }

  return builder.finish('spotify', account);
}

/* ------------------------------------------------------------------ */
/* Публичный API                                                       */
/* ------------------------------------------------------------------ */

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)(?:$|\?)/i;

function splitArtistTitle(value) {
  const source = text(value, '');
  const parts = source.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: 'Неизвестный исполнитель', title: source };
}

function nameFromUrl(value) {
  try {
    const parsed = new URL(value);
    let name = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
    name = decodeURIComponent(name).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_+]+/g, ' ');
    return splitArtistTitle(name);
  } catch (error) {
    return { artist: 'Неизвестный исполнитель', title: 'Аудиопоток' };
  }
}

function resolveUrl(value, base) {
  try {
    return new URL(value, base).toString();
  } catch (error) {
    return null;
  }
}

function addLinkTrack(builder, data, collectionId) {
  if (!data || (!data.url && !data.title)) return null;
  return builder.addTrack({
    id: data.id || `link_${Date.now()}_${builder.size()}`,
    externalId: data.externalId || null,
    title: text(data.title, 'Без названия'),
    artist: text(data.artist, 'Неизвестный исполнитель'),
    album: text(data.album, ''),
    duration: Number(data.duration) || 0,
    url: data.url || null,
    image: data.image || null,
    source: 'link',
    provider: data.provider || 'link',
    public: data.public === true,
    origin: collectionId
  });
}

function parseM3U(raw, baseUrl) {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  let pending = null;
  const entries = [];
  lines.forEach((line) => {
    const value = line.trim();
    if (!value || value.indexOf('#EXTM3U') === 0) return;
    if (value.indexOf('#EXTINF:') === 0) {
      const comma = value.indexOf(',');
      pending = comma === -1 ? '' : value.slice(comma + 1);
      return;
    }
    if (value.charAt(0) === '#') return;
    const url = resolveUrl(value, baseUrl);
    if (url) entries.push({ url, meta: pending || '' });
    pending = null;
  });
  return entries;
}

function parsePLS(raw, baseUrl) {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  const files = {};
  const titles = {};
  lines.forEach((line) => {
    let match = line.match(/^\s*File(\d+)\s*=\s*(.+)$/i);
    if (match) files[match[1]] = resolveUrl(match[2].trim(), baseUrl);
    match = line.match(/^\s*Title(\d+)\s*=\s*(.+)$/i);
    if (match) titles[match[1]] = match[2].trim();
  });
  return Object.keys(files)
    .filter((key) => !!files[key])
    .map((key) => ({ url: files[key], meta: titles[key] || '' }));
}

function parseXSPF(raw, baseUrl) {
  const entries = [];
  const blocks = raw.match(/<track\b[\s\S]*?<\/track>/gi) || [];
  blocks.forEach((block) => {
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
    entries.push({
      url,
      meta: [creator ? creator[1] : '', title ? title[1] : ''].filter(Boolean).join(' - ')
    });
  });
  return entries;
}

async function importSpotifyPublicLink(link, builder) {
  const match = link.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?(playlist|album|track)\/([A-Za-z0-9]+)/);
  if (!match) throw new Error('Не удалось распознать ссылку Spotify');

  builder.progress('link', 'Читаем публичную страницу Spotify…', 'link');
  const kind = match[1];
  const id = match[2];
  const html = await requestText(`https://open.spotify.com/embed/${kind}/${id}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' }
  });
  const script = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!script) throw new Error('Spotify не вернул данные публичной страницы');

  let entity;
  try {
    const data = JSON.parse(script[1]);
    entity =
      data &&
      data.props &&
      data.props.pageProps &&
      data.props.pageProps.state &&
      data.props.pageProps.state.data &&
      data.props.pageProps.state.data.entity;
  } catch (error) {
    throw new Error('Не удалось разобрать ответ Spotify');
  }
  if (!entity) throw new Error('Публичная страница Spotify пуста или недоступна');

  const list = Array.isArray(entity.trackList) && entity.trackList.length ? entity.trackList : [entity];
  const cover =
    entity.coverArt && entity.coverArt.sources && entity.coverArt.sources[0]
      ? entity.coverArt.sources[0].url
      : null;
  const collectionId = `link_spotify_${entity.id || id}`;
  const trackIds = [];
  let withoutPreview = 0;

  list.forEach((item) => {
    if (!item) return;
    const uri = item.uri || '';
    const trackId =
      uri.indexOf('spotify:track:') === 0
        ? uri.slice('spotify:track:'.length)
        : item.uid || String(Math.random()).slice(2);
    const preview = item.audioPreview && item.audioPreview.url ? item.audioPreview.url : null;
    if (!preview) withoutPreview++;
    const added = addLinkTrack(
      builder,
      {
        id: `link_spotify_${trackId}`,
        externalId: trackId,
        title: item.title,
        artist: item.subtitle,
        album: entity.name || '',
        duration: item.duration ? Math.round(item.duration / 1000) : 0,
        url: preview,
        image: cover,
        provider: 'spotify'
      },
      collectionId
    );
    if (added) trackIds.push(added.id);
  });

  if (!trackIds.length) throw new Error('В этой ссылке Spotify нет треков');
  if (withoutPreview) builder.warn(`Spotify: для ${withoutPreview} треков нет 30-секундного превью.`);
  builder.addCollection(
    {
      id: collectionId,
      type: kind === 'album' ? 'album' : 'playlist',
      title: text(entity.name || entity.title, 'Spotify'),
      subtitle: text(entity.subtitle || entity.owner || 'Публичная ссылка Spotify', ''),
      image: cover,
      trackIds
    },
    'link'
  );
  return builder.finish('link', null);
}

async function importYandexPublicLink(link, builder) {
  builder.progress('link', 'Читаем публичную страницу Яндекс Музыки…', 'link');
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
    result = await yandexGet(`/users/${encodeURIComponent(login)}/playlists/${kind}`, null);
    collectionId = `link_yandex_${login}_${kind}`;
    title = result.title;
    subtitle = result.owner && (result.owner.name || result.owner.login);
    image = yandexPlaylistImage(result);
  } else if (uuidMatch) {
    result = await yandexGet(`/playlists/${encodeURIComponent(uuidMatch[1])}`, null);
    collectionId = `link_yandex_${uuidMatch[1]}`;
    title = result.title;
    subtitle = result.owner && (result.owner.name || result.owner.login);
    image = yandexPlaylistImage(result);
  } else if (albumMatch) {
    const albumId = albumMatch[1];
    result = await yandexGet(`/albums/${encodeURIComponent(albumId)}/with-tracks`, null);
    collectionType = 'album';
    collectionId = `link_yandex_album_${albumId}`;
    title = result.title;
    subtitle = yandexArtists(result.artists);
    image = yandexImage(result.coverUri);
  } else {
    throw new Error('Поддерживаются ссылки на плейлист или альбом Яндекс Музыки');
  }

  if (!result) throw new Error('Яндекс Музыка не вернул данные по ссылке');
  const rawTracks = result.volumes
    ? result.volumes.reduce((all, volume) => all.concat(volume || []), [])
    : yandexExtractTracks(result);
  const trackIds = [];

  rawTracks.forEach((entry) => {
    const track = entry && entry.track ? entry.track : entry;
    const mapped = yandexMapTrack(track, title);
    if (!mapped) return;
    const added = addLinkTrack(
      builder,
      {
        id: `link_${mapped.id}`,
        externalId: mapped.externalId,
        title: mapped.title,
        artist: mapped.artist,
        album: mapped.album,
        duration: mapped.duration,
        url: null,
        image: mapped.image,
        provider: 'yandex',
        public: true
      },
      collectionId
    );
    if (added) trackIds.push(added.id);
  });

  if (!trackIds.length) throw new Error('В этой ссылке Яндекс Музыки нет треков');
  builder.addCollection(
    {
      id: collectionId,
      type: collectionType,
      title: text(title, 'Яндекс Музыка'),
      subtitle: text(subtitle, 'Публичная ссылка'),
      image,
      trackIds
    },
    'link'
  );
  return builder.finish('link', null);
}

async function importListLink(link, builder) {
  builder.progress('link', 'Загружаем список треков…', 'link');
  const raw = await requestText(link);
  let entries = [];
  if (/^\s*#EXTM3U/i.test(raw) || /\.m3u8?(?:$|\?)/i.test(link)) entries = parseM3U(raw, link);
  else if (/^\s*\[playlist\]/i.test(raw) || /\.pls(?:$|\?)/i.test(link)) entries = parsePLS(raw, link);
  else if (/<playlist\b/i.test(raw) || /\.xspf(?:$|\?)/i.test(link)) entries = parseXSPF(raw, link);
  else throw new Error('Не удалось распознать формат списка (M3U, PLS или XSPF)');

  const collectionId = `link_list_${Math.abs(hashString(link))}`;
  const trackIds = [];
  entries.forEach((entry) => {
    const meta = splitArtistTitle(entry.meta);
    const fallback = nameFromUrl(entry.url);
    const added = addLinkTrack(
      builder,
      {
        title: meta.title || fallback.title,
        artist: meta.artist || fallback.artist,
        album: '',
        duration: 0,
        url: entry.url,
        provider: 'link'
      },
      collectionId
    );
    if (added) trackIds.push(added.id);
  });

  if (!trackIds.length) throw new Error('В списке не найдено ни одного трека');
  let title = 'Плейлист по ссылке';
  try {
    title = decodeURIComponent(new URL(link).pathname.split('/').filter(Boolean).pop() || title);
  } catch (error) {
    // keep default
  }
  builder.addCollection(
    {
      id: collectionId,
      type: 'playlist',
      title,
      subtitle: 'Импортировано по ссылке',
      image: null,
      trackIds
    },
    'link'
  );
  return builder.finish('link', null);
}

function importDirectAudio(link, builder) {
  const meta = nameFromUrl(link);
  const collectionId = `link_audio_${Math.abs(hashString(link))}`;
  const added = addLinkTrack(
    builder,
    {
      title: meta.title,
      artist: meta.artist,
      album: '',
      duration: 0,
      url: link,
      provider: 'link'
    },
    collectionId
  );
  if (!added) throw new Error('Не удалось добавить аудиоссылку');
  builder.addCollection(
    {
      id: collectionId,
      type: 'playlist',
      title: meta.title,
      subtitle: 'Аудиоссылка',
      image: null,
      trackIds: [added.id]
    },
    'link'
  );
  return builder.finish('link', null);
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export async function importPublicLink(link, onProgress) {
  const value = text(link, '');
  if (!/^https?:\/\//i.test(value)) {
    throw new Error('Вставьте ссылку, начинающуюся с http:// или https://');
  }
  const builder = createBuilder(onProgress);

  if (/open\.spotify\.com\//i.test(value)) return importSpotifyPublicLink(value, builder);
  if (/music\.yandex\.[a-z]+\//i.test(value)) return importYandexPublicLink(value, builder);
  if (/vk\.com\/|vk\.ru\//i.test(value)) {
    throw new Error('Публичные ссылки VK Музыки требуют токен. Используйте импорт VK с токеном.');
  }
  if (/\.(m3u8?|pls|xspf)(?:$|\?)/i.test(value)) return importListLink(value, builder);
  if (AUDIO_EXT.test(value)) return importDirectAudio(value, builder);
  throw new Error('Поддерживаются ссылки Spotify, Яндекс Музыки, M3U/PLS/XSPF и прямые аудиоссылки.');
}

export async function importMusic(service, token, onProgress) {
  if (!token) throw new Error('Токен не указан');
  const builder = createBuilder(onProgress);
  if (service === 'vk') return importVKFull(token, builder);
  if (service === 'yandex') return importYandexFull(token, builder);
  if (service === 'spotify') return importSpotifyFull(token, builder);
  throw new Error(`Неизвестный сервис: ${service}`);
}

export function getServiceName(service) {
  return SOURCE_NAMES[service] || service;
}

export const importVKMusic = (token, onProgress) => importMusic('vk', token, onProgress);
export const importYandexMusic = (token, onProgress) => importMusic('yandex', token, onProgress);
export const importSpotify = (token, onProgress) => importMusic('spotify', token, onProgress);

export const MAX_TRACKS_LIMIT = MAX_TRACKS;
