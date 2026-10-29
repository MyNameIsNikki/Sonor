// Import playlists exported from other players.
// Mobile can resolve direct https audio URLs; local paths from a desktop export
// are skipped because they do not exist inside the Android/iOS sandbox.
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import md5 from 'blueimp-md5';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PAGE_HOST = /(^|\.)(vk\.com|vk\.ru|music\.yandex\.[a-z]+|open\.spotify\.com)$/i;

function splitArtistTitle(value) {
  const raw = String(value || '').trim();
  if (!raw) return { artist: 'Неизвестный исполнитель', title: 'Без названия' };
  const dash = raw.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) return { artist: dash[1].trim(), title: dash[2].trim() };
  return { artist: 'Неизвестный исполнитель', title: raw };
}

function parseTime(value) {
  if (value === undefined || value === null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.max(0, Math.round(Number(raw)));
  const parts = raw.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return Math.max(0, Math.round(seconds));
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function isPlayableUrl(value) {
  const url = String(value || '').trim();
  if (!/^https:\/\//i.test(url)) return false;
  let host = '';
  let path = '';
  const match = url.match(/^https:\/\/([^/?#]+)([^?#]*)/i);
  if (match) {
    host = match[1].split(':')[0].toLowerCase();
    path = match[2] || '';
  }
  if (PAGE_HOST.test(host)) return false;
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|aiff?|alac|wma|webm)(\?|$)/i.test(path)) return true;
  return /(stream|download|get-mp3|get-music|media|audio)/i.test(path);
}

function providerFor(value) {
  try {
    const host = String(value).match(/^https?:\/\/([^/?#]+)/i)[1].toLowerCase();
    if (/(^|\.)vk\.com$|(^|\.)vk\.ru$/.test(host)) return 'vk';
    if (/music\.yandex\./.test(host) || /(^|\.)yandex\./.test(host)) return 'yandex';
    if (/(^|\.)spotify\.com$/.test(host)) return 'spotify';
  } catch (error) {
    return 'link';
  }
  return 'link';
}

function parseM3U(content) {
  const entries = [];
  let current = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#EXTINF:/i.test(line)) {
      const match = line.match(/^#EXTINF:\s*([^,]*),(.*)$/i);
      const duration = parseTime(match && match[1]);
      const meta = splitArtistTitle(decodeXml(match && match[2]));
      current = { duration, artist: meta.artist, title: meta.title, album: '' };
      continue;
    }
    if (/^#EXTALB:/i.test(line) && current) {
      current.album = decodeXml(line.replace(/^#EXTALB:\s*/i, ''));
      continue;
    }
    if (line.startsWith('#')) continue;
    entries.push({ location: line, ...(current || {}) });
    current = null;
  }
  return entries;
}

function parsePLS(content) {
  const map = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*([A-Za-z]+)(\d+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = `${match[1].toLowerCase()}${match[2]}`;
    map[key] = match[3];
  }
  const entries = [];
  for (let index = 1; index <= 5000; index += 1) {
    const location = map[`file${index}`];
    if (!location) continue;
    const title = map[`title${index}`] || '';
    const meta = splitArtistTitle(title);
    entries.push({
      location,
      title: meta.title,
      artist: meta.artist,
      album: '',
      duration: parseTime(map[`length${index}`])
    });
  }
  return entries;
}

function parseXSPF(content) {
  const entries = [];
  const blocks = content.match(/<track\b[\s\S]*?<\/track>/gi) || [];
  for (const block of blocks) {
    const locations = [...block.matchAll(/<location[^>]*>([\s\S]*?)<\/location>/gi)]
      .map((match) => decodeXml(match[1]).trim())
      .filter(Boolean);
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const creator = (block.match(/<creator[^>]*>([\s\S]*?)<\/creator>/i) || [])[1] || '';
    const album = (block.match(/<album[^>]*>([\s\S]*?)<\/album>/i) || [])[1] || '';
    const duration = (block.match(/<duration[^>]*>([\s\S]*?)<\/duration>/i) || [])[1] || '';
    for (const location of locations) {
      entries.push({
        location,
        title: decodeXml(title).trim() || splitArtistTitle(decodeXml(creator)).title,
        artist: decodeXml(creator).trim() || splitArtistTitle(decodeXml(title)).artist,
        album: decodeXml(album).trim(),
        duration: Math.round(Number(duration) / 1000) || 0
      });
    }
  }
  return entries;
}

function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',' || char === ';' || char === '\t') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => String(value).trim())) rows.push(row);
  return rows;
}

const FIELD_ALIASES = {
  title: ['title', 'name', 'track', 'song', 'название', 'трек', 'композиция'],
  artist: ['artist', 'performer', 'author', 'исполнитель', 'артист'],
  album: ['album', 'release', 'альбом'],
  duration: ['duration', 'length', 'time', 'длительность', 'время'],
  url: ['url', 'link', 'path', 'location', 'src', 'ссылка', 'путь']
};

function headerKey(value) {
  const key = String(value || '').trim().toLowerCase();
  for (const field of Object.keys(FIELD_ALIASES)) {
    if (FIELD_ALIASES[field].includes(key)) return field;
  }
  return null;
}

function parseCsv(content) {
  const rows = parseCsvRows(content);
  if (rows.length < 2) return [];
  const headers = rows[0].map(headerKey);
  if (!headers.includes('url')) return [];
  return rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((field, index) => {
      if (field) item[field] = row[index] || '';
    });
    const meta = item.title
      ? { title: item.title, artist: item.artist || 'Неизвестный исполнитель' }
      : splitArtistTitle(item.title);
    return {
      location: item.url,
      title: item.title || meta.title,
      artist: item.artist || meta.artist,
      album: item.album || '',
      duration: parseTime(item.duration)
    };
  });
}

function parseJson(content) {
  const data = JSON.parse(content);
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data.tracks)
      ? data.tracks
      : Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.songs)
          ? data.songs
          : Array.isArray(data.audios)
            ? data.audios
            : Array.isArray(data.entries)
              ? data.entries
              : [];
  return list.map((item) => {
    if (!item) return null;
    const location = item.url || item.link || item.path || item.location || item.src || item.stream;
    const title = item.title || item.name || item.track || item.song || '';
    const artistValue = item.artist || item.performer || item.author || (Array.isArray(item.artists) ? item.artists.map((artist) => (typeof artist === 'string' ? artist : artist && artist.name)).filter(Boolean).join(', ') : '');
    const albumValue = typeof item.album === 'string' ? item.album : (item.album && item.album.title) || '';
    const meta = splitArtistTitle(title);
    return {
      location,
      title: title || meta.title,
      artist: artistValue || meta.artist,
      album: albumValue,
      duration: parseTime(item.duration || item.length || item.time)
    };
  }).filter(Boolean);
}

function detectFormat(fileName, content) {
  const name = String(fileName || '').toLowerCase();
  if (/\.xspf$/i.test(name) || /<playlist[\s>]/i.test(content)) return 'xspf';
  if (/\.pls$/i.test(name) || /^\s*\[playlist\]/im.test(content)) return 'pls';
  if (/\.json$/i.test(name) || /^\s*[\[{]/.test(content)) return 'json';
  if (/\.csv$/i.test(name) || /\t/.test(content) || (content.split(/\r?\n/)[0] || '').includes(';')) return 'csv';
  return 'm3u';
}

function parseContent(content, fileName) {
  const format = detectFormat(fileName, content);
  if (format === 'json') return parseJson(content);
  if (format === 'csv') return parseCsv(content);
  if (format === 'pls') return parsePLS(content);
  if (format === 'xspf') return parseXSPF(content);
  return parseM3U(content);
}

function buildTrack(entry) {
  const location = String(entry.location || '').trim();
  if (!location) return null;
  const meta = entry.title
    ? { title: entry.title, artist: entry.artist || 'Неизвестный исполнитель' }
    : splitArtistTitle(location.split(/[\\/]/).pop());
  return {
    id: `mobpl_${md5(location)}`,
    title: meta.title || 'Без названия',
    artist: meta.artist || 'Неизвестный исполнитель',
    album: entry.album || '',
    duration: Math.max(0, Math.round(Number(entry.duration) || 0) * 1000),
    url: location,
    src: location,
    image: null,
    source: 'link',
    provider: providerFor(location),
    origin: null,
    public: true,
    license: null
  };
}

export function parsePlaylistText(content, fileName) {
  const entries = parseContent(String(content || ''), fileName);
  const tracks = [];
  const seen = new Set();
  let skipped = 0;
  const warnings = [];
  for (const entry of entries) {
    if (!entry || !isPlayableUrl(entry.location)) {
      skipped += 1;
      continue;
    }
    const track = buildTrack(entry);
    if (!track || seen.has(track.id)) {
      skipped += 1;
      continue;
    }
    seen.add(track.id);
    tracks.push(track);
  }
  if (!tracks.length) {
    throw new Error(
      skipped
        ? 'В файле нет прямых аудиоссылок. Ссылки на страницы VK, Яндекса или Spotify не подходят — нужен экспорт с URL аудиофайлов.'
        : 'В плейлисте не найдено треков'
    );
  }
  const title = String(fileName || 'Плейлист').replace(/\.[^.]+$/, '') || 'Плейлист';
  if (skipped) warnings.push(`Пропущено строк без прямых аудиоссылок: ${skipped}`);
  return {
    name: fileName || 'Плейлист',
    tracks,
    collection: {
      id: `playlist_mobile_${md5(`${fileName}:${tracks.map((track) => track.id).join(',')}`)}`,
      type: 'playlist',
      title,
      subtitle: `${tracks.length} треков · импорт из файла`,
      image: null,
      source: 'link',
      trackIds: tracks.map((track) => track.id)
    },
    skipped,
    warnings
  };
}

function assetList(result) {
  if (!result || result.canceled) return [];
  if (Array.isArray(result.assets)) return result.assets;
  if (result.type === 'success' && result.uri) return [result];
  return [];
}

export async function pickPlaylistFiles() {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'audio/x-mpegurl',
      'audio/mpegurl',
      'application/vnd.apple.mpegurl',
      'application/xspf+xml',
      'text/plain',
      'text/csv',
      'application/json',
      'application/octet-stream',
      '*/*'
    ],
    copyToCacheDirectory: true,
    multiple: true
  });
  const assets = assetList(result);
  if (!assets.length) return null;

  const tracks = [];
  const collections = [];
  const warnings = [];
  let skipped = 0;
  for (const asset of assets) {
    try {
      const info = await FileSystem.getInfoAsync(asset.uri);
      if (info.exists && info.size > MAX_FILE_BYTES) {
        warnings.push(`${asset.name}: файл больше 10 МБ`);
        continue;
      }
      const content = await FileSystem.readAsStringAsync(asset.uri);
      const parsed = parsePlaylistText(content, asset.name);
      tracks.push(...parsed.tracks);
      collections.push(parsed.collection);
      skipped += parsed.skipped;
      warnings.push(...parsed.warnings);
    } catch (error) {
      warnings.push(`${asset.name || 'Файл'}: ${error.message}`);
    }
  }
  if (!tracks.length) {
    throw new Error(warnings[0] || 'Не удалось прочитать выбранные плейлисты');
  }
  return { tracks, collections, skipped, warnings };
}

export { MAX_FILE_BYTES };
