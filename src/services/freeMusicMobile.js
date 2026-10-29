// Legal free-music catalogs for the mobile app.
// Audius is stream-only; ccMixter and Internet Archive allow direct downloads.
import * as FileSystem from 'expo-file-system';

const APP_NAME = 'Sonor';
const AUDIUS_API = 'https://api.audius.co';
const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;
const DOWNLOAD_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}Sonor/`
  : null;
const SOURCE_LABELS = {
  all: 'Все',
  audius: 'Audius',
  ccmixter: 'ccMixter',
  archive: 'Archive'
};

async function fetchJson(url) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 22000) : null;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller ? controller.signal : undefined
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
    }
    return await response.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function parseDuration(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value * 1000));
  }
  const raw = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.max(0, Math.round(Number(raw) * 1000));
  const parts = raw.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return Math.max(0, Math.round(seconds * 1000));
}

function imageUrl(value) {
  if (!value) return null;
  let url = String(value);
  if (url.startsWith('//')) url = `https:${url}`;
  if (url.startsWith('http://')) url = `https://${url.slice(7)}`;
  return url;
}

function providerForHost(host) {
  if (/(^|\.)vk\.com$|(^|\.)vk\.ru$/i.test(host)) return 'vk';
  if (/music\.yandex\./i.test(host) || /(^|\.)yandex\./i.test(host)) return 'yandex';
  if (/(^|\.)spotify\.com$/i.test(host)) return 'spotify';
  return 'link';
}

function parseHttpUrl(value) {
  const match = String(value || '').match(/^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i);
  if (!match) return null;
  return {
    protocol: `${match[1].toLowerCase()}:`,
    hostname: match[2].split(':')[0].toLowerCase(),
    pathname: match[3] || '/',
    search: match[4] || ''
  };
}

function isAudioUrl(url) {
  const parsed = parseHttpUrl(url);
  if (!parsed) return false;
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|aiff?|alac|wma|webm)(\?|$)/i.test(parsed.pathname + parsed.search)) {
    return true;
  }
  const host = parsed.hostname;
  if (/(^|\.)(vk\.com|vk\.ru|music\.yandex\.[a-z]+|open\.spotify\.com)$/i.test(host)) return false;
  return /(stream|download|get-mp3|get-music|media|audio)/i.test(parsed.pathname + parsed.search);
}

function mapAudius(item) {
  if (!item || !item.id) return null;
  if (item.is_available === false || item.is_streamable === false || item.is_stream_gated) {
    return null;
  }
  const license = text(item.license, '');
  if (/all rights reserved/i.test(license)) return null;
  const artwork = item.artwork || {};
  const streamUrl = item.stream && item.stream.url ? item.stream.url : null;
  return {
    id: `audius_${item.id}`,
    externalId: String(item.id),
    title: text(item.title, 'Без названия'),
    artist: text(item.user && (item.user.name || item.user.handle), 'Audius'),
    album: text(item.genre, ''),
    duration: Math.max(0, Math.round((Number(item.duration) || 0) * 1000)),
    url: null,
    src: streamUrl,
    image: imageUrl(artwork['480x480'] || artwork['150x150'] || artwork['1000x1000']),
    source: 'audius',
    provider: 'audius',
    license,
    licenseUrl: null,
    filePageUrl: item.permalink ? `https://audius.co${item.permalink}` : null,
    downloadable: false,
    streamOnly: true
  };
}

async function searchAudius(query, limit) {
  const url = `${AUDIUS_API}/v1/tracks/search?query=${encodeURIComponent(query)}&limit=${Math.min(Math.max(limit || 18, 1), 40)}&app_name=${APP_NAME}`;
  const data = await fetchJson(url);
  return (Array.isArray(data.data) ? data.data : [])
    .map(mapAudius)
    .filter(Boolean);
}

async function searchCcmixter(query, limit) {
  const url = `https://ccmixter.org/api/query?f=json&limit=${Math.min(Math.max(limit || 18, 1), 40)}&search=${encodeURIComponent(query)}`;
  const data = await fetchJson(url);
  const items = Array.isArray(data) ? data : Array.isArray(data.results) ? data.results : [];
  const tracks = [];
  for (const item of items) {
    if (!item || !item.upload_id || (item.upload_extra && item.upload_extra.nsfw)) continue;
    const files = Array.isArray(item.files) ? item.files : [];
    const file =
      files.find((entry) => /^mp3$/i.test(entry.file_nicname || '') || /\.mp3(\?|$)/i.test(entry.download_url || '')) ||
      files.find((entry) => /\.(ogg|flac|m4a)(\?|$)/i.test(entry.download_url || ''));
    if (!file || !isAudioUrl(file.download_url)) continue;
    const durationValue = file.file_format_info && file.file_format_info.ps
      ? file.file_format_info.ps
      : file.file_format_info && file.file_format_info.duration;
    tracks.push({
      id: `ccmixter_${item.upload_id}`,
      externalId: String(item.upload_id),
      title: text(item.upload_name, 'Без названия'),
      artist: text(item.user_real_name || item.user_name, 'ccMixter'),
      album: 'ccMixter',
      duration: parseDuration(durationValue),
      url: isAudioUrl(file.download_url) ? file.download_url : null,
      src: isAudioUrl(file.download_url) ? file.download_url : null,
      image: imageUrl(item.user_avatar_url || item.upload_image),
      source: 'ccmixter',
      provider: 'ccmixter',
      license: text(item.license_name, 'Creative Commons'),
      licenseUrl: text(item.license_url, ''),
      filePageUrl: text(item.file_page_url, ''),
      downloadable: true,
      streamOnly: false
    });
  }
  return tracks;
}

function archiveDuration(value) {
  if (value === undefined || value === null) return 0;
  const raw = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.max(0, Math.round(Number(raw) * 1000));
  const parts = raw.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return Math.max(0, Math.round(seconds * 1000));
}

async function archiveItem(doc) {
  if (!doc || !doc.identifier) return [];
  const metadata = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
  const meta = (metadata && metadata.metadata) || {};
  const licenseUrl = text(meta.licenseurl || doc.licenseurl, '');
  if (!licenseUrl) return [];
  const files = (Array.isArray(metadata.files) ? metadata.files : [])
    .filter((file) => {
      const name = String(file.name || '');
      if (!/\.(mp3|ogg|flac|m4a|wav)(\?|$)/i.test(name)) return false;
      if (/spectrogram|sample|thumb|__ia_thumb/i.test(name)) return false;
      if (Number(file.size) > MAX_DOWNLOAD_BYTES) return false;
      return true;
    })
    .sort((a, b) => {
      const score = (file) => (/\.mp3$/i.test(file.name || '') ? 3 : 0) + (/original/i.test(file.source || '') ? 2 : 0) + (/VBR/i.test(file.format || '') ? 1 : 0);
      return score(b) - score(a);
    })
    .slice(0, 2);

  return files.map((file, index) => {
    const encodedPath = String(file.name).split('/').map(encodeURIComponent).join('/');
    const url = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodedPath}`;
    return {
      id: `archive_${doc.identifier}_${index}`,
      externalId: String(doc.identifier),
      title: text(file.title || meta.title, file.name),
      artist: text(meta.creator || doc.creator, 'Internet Archive'),
      album: text(meta.title, 'Internet Archive'),
      duration: archiveDuration(file.length),
      url,
      src: url,
      image: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
      source: 'archive',
      provider: 'archive',
      license: licenseUrl,
      licenseUrl,
      filePageUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
      downloadable: true,
      streamOnly: false
    };
  });
}

async function searchArchive(query, limit) {
  const terms = query.split(/\s+/).filter(Boolean).map((term) => `(${term})`).join(' AND ');
  const q = `(mediatype:audio AND collection:opensource_audio AND format:MP3 AND licenseurl:*)${terms ? ` AND ${terms}` : ''}`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&rows=${Math.min(Math.max(limit || 6, 1), 8)}&page=1&output=json&sort[]=downloads+desc`;
  const data = await fetchJson(url);
  const docs = (data && data.response && Array.isArray(data.response.docs)) ? data.response.docs : [];
  const groups = [];
  for (const doc of docs) {
    try {
      groups.push(await archiveItem(doc));
    } catch (error) {
      // One broken item must not hide the rest of the catalog.
      groups.push([]);
    }
  }
  return [].concat(...groups);
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source;
}

function interleave(groups) {
  const output = [];
  const seen = new Set();
  const max = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < max; index += 1) {
    for (const group of groups) {
      const track = group[index];
      if (!track || seen.has(track.id)) continue;
      seen.add(track.id);
      output.push(track);
    }
  }
  return output.slice(0, 60);
}

export async function searchFreeMusic(query, source = 'all') {
  const cleaned = text(query, 'lofi').slice(0, 80);
  const selected = source === 'all' ? ['audius', 'ccmixter', 'archive'] : [source];
  const runners = {
    audius: () => searchAudius(cleaned, 18),
    ccmixter: () => searchCcmixter(cleaned, 18),
    archive: () => searchArchive(cleaned, 6)
  };
  const results = await Promise.all(
    selected.map(async (key) => {
      try {
        return { key, tracks: await runners[key]() };
      } catch (error) {
        return { key, tracks: [], error: `${sourceLabel(key)}: ${error.message || 'ошибка сети'}` };
      }
    })
  );
  const groups = results.map((result) => result.tracks);
  const warnings = results.map((result) => result.error).filter(Boolean);
  const tracks = interleave(groups);
  if (!tracks.length) {
    throw new Error(warnings.length ? warnings.join('; ') : 'Ничего не найдено');
  }
  return {
    query: cleaned,
    source,
    tracks,
    warnings,
    counts: results.reduce((map, result) => {
      map[result.key] = result.tracks.length;
      return map;
    }, {})
  };
}

export async function resolveAudiusStream(externalId) {
  const id = String(externalId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('Некорректный идентификатор трека');
  const data = await fetchJson(`${AUDIUS_API}/v1/tracks/${id}?app_name=${APP_NAME}`);
  const url = data && data.data && data.data.stream && data.data.stream.url;
  if (!url) throw new Error('Audius не выдал ссылку на поток');
  return url;
}

function isAllowedHost(host) {
  const value = String(host || '').toLowerCase();
  return value === 'ccmixter.org' || value.endsWith('.ccmixter.org') || value === 'archive.org' || value.endsWith('.archive.org');
}

function safeName(value) {
  return String(value || 'track')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110) || 'track';
}

function extensionFor(url) {
  const parsed = parseHttpUrl(url);
  const match = parsed && parsed.pathname.match(/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|aiff?|alac|wma|webm)$/i);
  return match ? `.${match[1].toLowerCase()}` : '.mp3';
}

export async function downloadFreeTrack(track) {
  if (!DOWNLOAD_DIR) throw new Error('Хранилище устройства недоступно');
  if (!track || track.source === 'audius' || !track.downloadable) {
    throw new Error('Этот каталог отдаёт только поток, скачивание недоступно');
  }
  const parsed = parseHttpUrl(track.url);
  if (!parsed || parsed.protocol !== 'https:' || !isAllowedHost(parsed.hostname)) {
    throw new Error('Домен источника не разрешён для скачивания');
  }

  await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true }).catch(() => {});
  const base = `${safeName(`${track.artist} - ${track.title}`)}${extensionFor(track.url)}`;
  let destination = `${DOWNLOAD_DIR}${base}`;
  const existing = await FileSystem.getInfoAsync(destination);
  if (existing.exists) {
    destination = `${DOWNLOAD_DIR}${base.replace(/(\.[^.]+)$/, ' (2)$1')}`;
  }

  const result = await FileSystem.downloadAsync(
    track.url,
    destination,
    track.source === 'ccmixter'
      ? { headers: { Referer: 'https://ccmixter.org/' } }
      : {}
  );
  const info = await FileSystem.getInfoAsync(result.uri);
  if (!info.exists || !info.size) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
    throw new Error('Источник вернул пустой файл');
  }
  if (info.size > MAX_DOWNLOAD_BYTES) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
    throw new Error('Файл больше 300 МБ');
  }
  return {
    path: result.uri,
    size: info.size,
    name: result.uri.split('/').pop()
  };
}

export { MAX_DOWNLOAD_BYTES, DOWNLOAD_DIR };
