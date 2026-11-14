'use strict';

// Поиск синхронизированных текстов песен через открытую базу LRCLib.
// Не требует токенов и работает для любого источника: локальных файлов,
// VK, Яндекс Музыки, Spotify и свободных каталогов.

const {
  buildLyricsResult,
  normalizeQuery,
  pickBestCandidate
} = require('./lyricsCore');

const API_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'Sonor/1.8.0 (https://github.com/MyNameIsNikki/Sonor)';
const REQUEST_TIMEOUT = 9000;
const CACHE_TTL = 6 * 60 * 60 * 1000;
const CACHE_LIMIT = 120;

const cache = new Map();

function cacheKey(query) {
  return [query.title, query.artist, query.album, Math.round(query.duration)]
    .join('|')
    .toLowerCase();
}

function readCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.at > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function writeCache(key, value) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { at: Date.now(), value: value });
}

async function fetchJson(url) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT) : null;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        'Lrclib-Client': USER_AGENT
      },
      signal: controller ? controller.signal : undefined
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error('Сервис текстов ответил ошибкой ' + response.status);
    }
    return await response.json();
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Сервис текстов не ответил. Проверьте подключение к интернету.');
    }
    if (error && error.name === 'TypeError') {
      throw new Error('Не удалось связаться с LRCLib. Проверьте подключение к интернету.');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function searchUrl(params) {
  const query = new URLSearchParams();
  Object.keys(params).forEach(function (key) {
    if (params[key]) query.set(key, params[key]);
  });
  return API_BASE + '/search?' + query.toString();
}

async function search(params) {
  const data = await fetchJson(searchUrl(params));
  return Array.isArray(data) ? data : [];
}

function timeLabel(seconds) {
  const value = Number(seconds) || 0;
  return value > 0 ? Math.round(value) : 0;
}

function withQueryInfo(result, query) {
  return Object.assign({}, result, {
    query: {
      title: query.title,
      artist: query.artist,
      album: query.album,
      duration: timeLabel(query.duration)
    },
    fetchedAt: new Date().toISOString()
  });
}

async function lookupLyrics(input) {
  const query = normalizeQuery(input);
  if (!query.title) {
    throw new Error('Не указано название трека');
  }

  const key = cacheKey(query);
  const cached = readCache(key);
  if (cached) return Object.assign({}, cached, { cached: true });

  const attempts = [];
  if (query.artist) {
    attempts.push({ track_name: query.title, artist_name: query.artist });
  }
  query.titleVariants.slice(1).forEach(function (title) {
    if (query.artist) attempts.push({ track_name: title, artist_name: query.artist });
    else attempts.push({ track_name: title });
  });
  if (!query.artist) attempts.push({ track_name: query.title });
  if (query.artist) {
    attempts.push({ q: query.title + ' ' + query.artist });
  } else {
    attempts.push({ q: query.title });
  }

  const seen = {};
  let candidates = [];

  for (let index = 0; index < attempts.length; index++) {
    const chunk = await search(attempts[index]);
    chunk.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      const id = item.id || [item.trackName, item.artistName, item.albumName, item.duration].join('|');
      if (seen[id]) return;
      seen[id] = true;
      candidates.push(item);
    });
    if (pickBestCandidate(candidates, query)) break;
  }

  const best = pickBestCandidate(candidates, query);
  const result = withQueryInfo(buildLyricsResult(best), query);
  if (result.found) writeCache(key, result);
  return result;
}

function clearLyricsCache() {
  cache.clear();
}

module.exports = {
  clearLyricsCache,
  lookupLyrics
};
