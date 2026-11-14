// Синхронизированные тексты песен для телефона через открытую базу LRCLib.
// Работает без токенов и не зависит от источника трека.
import {
  buildLyricsResult,
  normalizeQuery,
  pickBestCandidate
} from './lyricsCore';

const API_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'Sonor/1.8.1 (https://github.com/MyNameIsNikki/Sonor)';
const REQUEST_TIMEOUT = 9000;
const CACHE_TTL = 6 * 60 * 60 * 1000;
const CACHE_LIMIT = 80;

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
  cache.set(key, { at: Date.now(), value });
}

function searchUrl(params) {
  const query = Object.keys(params)
    .filter((key) => params[key])
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&');
  return `${API_BASE}/search?${query}`;
}

async function fetchJson(url) {
  let timer = null;
  let controller = null;

  try {
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    }

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
      throw new Error(`Сервис текстов ответил ошибкой ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Сервис текстов не ответил. Проверьте подключение к интернету.');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function search(params) {
  const data = await fetchJson(searchUrl(params));
  return Array.isArray(data) ? data : [];
}

export async function lookupLyrics(input) {
  const query = normalizeQuery(input);
  if (!query.title) {
    throw new Error('Не указано название трека');
  }

  const key = cacheKey(query);
  const cached = readCache(key);
  if (cached) return { ...cached, cached: true };

  const attempts = [];
  if (query.artist) {
    attempts.push({ track_name: query.title, artist_name: query.artist });
  }
  query.titleVariants.slice(1).forEach((title) => {
    if (query.artist) attempts.push({ track_name: title, artist_name: query.artist });
    else attempts.push({ track_name: title });
  });
  if (!query.artist) attempts.push({ track_name: query.title });
  attempts.push({ q: query.artist ? `${query.title} ${query.artist}` : query.title });

  const seen = {};
  const candidates = [];
  let firstError = null;

  for (let index = 0; index < attempts.length; index += 1) {
    let chunk;
    try {
      chunk = await search(attempts[index]);
    } catch (error) {
      if (!firstError) firstError = error;
      continue;
    }
    chunk.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const id = item.id || [item.trackName, item.artistName, item.albumName, item.duration].join('|');
      if (seen[id]) return;
      seen[id] = true;
      candidates.push(item);
    });
    const bestForAttempt = pickBestCandidate(candidates, query);
    if (bestForAttempt && bestForAttempt.syncedLyrics) break;
  }

  if (!candidates.length && firstError) throw firstError;

  const best = pickBestCandidate(candidates, query);
  const result = {
    ...buildLyricsResult(best),
    query: {
      title: query.title,
      artist: query.artist,
      album: query.album,
      duration: Math.round(query.duration) || 0
    },
    fetchedAt: new Date().toISOString()
  };

  if (result.found) writeCache(key, result);
  return result;
}

export function clearLyricsCache() {
  cache.clear();
}
