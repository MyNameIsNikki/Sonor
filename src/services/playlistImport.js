/**
 * Импорт плейлистов, экспортированных из музыкальных сервисов.
 *
 * Поддерживаются M3U/M3U8, PLS, XSPF, CSV и JSON. Модуль не обращается
 * к закрытым API: он читает только локальный файл и добавляет в библиотеку
 * прямые аудиоссылки или локальные аудиофайлы, которые уже есть на диске.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL, fileURLToPath } = require('url');

const MAX_TRACKS = 5000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|aiff?|alac|wma|webm)(?:$|[?#])/i;
const PAGE_HOST = /(^|\.)(vk\.com|vk\.ru|music\.yandex\.[a-z]+|open\.spotify\.com)$/i;

function sha1(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex');
}

function text(value, fallback) {
  if (value === undefined || value === null) return fallback || '';
  const result = String(value).replace(/\s+/g, ' ').trim();
  return result || (fallback || '');
}

function splitArtistTitle(value) {
  const source = text(value, '');
  const parts = source.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: '', title: source };
}

function parseTime(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') {
    if (!isFinite(value) || value <= 0) return 0;
    return value > 100000 ? Math.round(value / 1000) : Math.round(value);
  }
  const raw = String(value).trim().replace(',', '.');
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const number = Number(raw);
    return number > 100000 ? Math.round(number / 1000) : Math.round(number);
  }
  const parts = raw.split(':').map(Number);
  if (parts.some(function (part) { return !isFinite(part); })) return 0;
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
  return 0;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, function (_, code) { return String.fromCharCode(Number(code)); })
    .trim();
}

function readText(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('Это не файл');
  if (stat.size > MAX_FILE_BYTES) throw new Error('Файл плейлиста слишком большой (максимум 10 МБ)');
  const buffer = fs.readFileSync(filePath);
  let raw = buffer.toString('utf8');
  if (raw.indexOf('\uFFFD') !== -1) {
    try {
      raw = new TextDecoder('windows-1251').decode(buffer);
    } catch (err) {
      /* UTF-8 is the best remaining option */
    }
  }
  return raw.replace(/^\uFEFF/, '');
}

function parseM3U(raw) {
  const lines = raw.split(/\r?\n/);
  const entries = [];
  let pending = null;

  lines.forEach(function (line) {
    const value = line.trim();
    if (!value) return;
    if (/^#EXTM3U/i.test(value)) return;
    if (/^#EXTINF:/i.test(value)) {
      const comma = value.indexOf(',');
      const info = comma === -1 ? '' : value.slice(comma + 1);
      const duration = comma === -1 ? 0 : parseTime(value.slice(8, comma));
      pending = { meta: info, duration: duration };
      return;
    }
    if (/^#EXTALB:/i.test(value)) {
      if (!pending) pending = { meta: '', duration: 0 };
      pending.album = text(value.slice(8));
      return;
    }
    if (value.charAt(0) === '#') return;
    entries.push({
      location: value,
      meta: pending ? pending.meta : '',
      album: pending ? pending.album : '',
      duration: pending ? pending.duration : 0
    });
    pending = null;
  });

  return entries;
}

function parsePLS(raw) {
  const files = {};
  const titles = {};
  const lengths = {};
  raw.split(/\r?\n/).forEach(function (line) {
    let match = line.match(/^\s*File(\d+)\s*=\s*(.+)$/i);
    if (match) files[match[1]] = match[2].trim();
    match = line.match(/^\s*Title(\d+)\s*=\s*(.+)$/i);
    if (match) titles[match[1]] = match[2].trim();
    match = line.match(/^\s*Length(\d+)\s*=\s*(.+)$/i);
    if (match) lengths[match[1]] = match[2].trim();
  });
  return Object.keys(files).map(function (key) {
    return {
      location: files[key],
      meta: titles[key] || '',
      duration: parseTime(lengths[key] || 0)
    };
  });
}

function parseXSPF(raw) {
  const entries = [];
  const blocks = raw.match(/<track\b[\s\S]*?<\/track>/gi) || [];
  blocks.forEach(function (block) {
    const location = block.match(/<location[^>]*>([\s\S]*?)<\/location>/i);
    if (!location) return;
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const creator = block.match(/<creator[^>]*>([\s\S]*?)<\/creator>/i);
    const album = block.match(/<album[^>]*>([\s\S]*?)<\/album>/i);
    const duration = block.match(/<duration[^>]*>([\s\S]*?)<\/duration>/i);
    const meta = [creator ? decodeXml(creator[1]) : '', title ? decodeXml(title[1]) : ''].filter(Boolean).join(' - ');
    entries.push({
      location: decodeXml(location[1]),
      meta: meta,
      album: album ? decodeXml(album[1]) : '',
      duration: duration ? Math.round((Number(duration[1]) || 0) / 1000) : 0
    });
  });
  return entries;
}

function parseCsvRows(raw) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (quoted) {
      if (char === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
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
      if (row.some(function (cell) { return cell.trim(); })) rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  row.push(field);
  if (row.some(function (cell) { return cell.trim(); })) rows.push(row);
  return rows;
}

function headerKey(value) {
  return text(value).toLowerCase().replace(/^\uFEFF/, '').replace(/[^a-zа-я0-9]+/gi, '');
}

const FIELD_ALIASES = {
  title: ['title', 'name', 'track', 'song', 'composition', 'название', 'трек', 'композиция'],
  artist: ['artist', 'performer', 'creator', 'author', 'исполнитель', 'артист', 'автор'],
  album: ['album', 'альбом'],
  duration: ['duration', 'length', 'time', 'длительность', 'время'],
  url: ['url', 'link', 'location', 'path', 'file', 'audio', 'ссылка', 'путь', 'файл']
};

function findField(headers, field) {
  const aliases = FIELD_ALIASES[field];
  for (let i = 0; i < headers.length; i++) {
    if (aliases.indexOf(headers[i]) !== -1) return i;
  }
  return -1;
}

function parseCsv(raw) {
  const rows = parseCsvRows(raw);
  if (!rows.length) return [];
  const headers = rows[0].map(headerKey);
  const indexes = {
    title: findField(headers, 'title'),
    artist: findField(headers, 'artist'),
    album: findField(headers, 'album'),
    duration: findField(headers, 'duration'),
    url: findField(headers, 'url')
  };
  const hasHeader = indexes.title !== -1 || indexes.artist !== -1 || indexes.url !== -1;
  const body = hasHeader ? rows.slice(1) : rows;

  return body.map(function (cells) {
    if (!hasHeader) {
      return { location: cells[2] || '', meta: [cells[1] || '', cells[0] || ''].filter(Boolean).join(' - ') };
    }
    const meta = [indexes.artist !== -1 ? cells[indexes.artist] : '', indexes.title !== -1 ? cells[indexes.title] : '']
      .filter(Boolean).join(' - ');
    return {
      location: indexes.url !== -1 ? cells[indexes.url] : '',
      meta: meta,
      album: indexes.album !== -1 ? cells[indexes.album] : '',
      duration: indexes.duration !== -1 ? parseTime(cells[indexes.duration]) : 0
    };
  }).filter(function (entry) { return entry.location || entry.meta; });
}

function firstValue(object, keys) {
  for (let i = 0; i < keys.length; i++) {
    const value = object[keys[i]];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function jsonArtist(value) {
  if (Array.isArray(value)) {
    return value.map(function (item) {
      return typeof item === 'string' ? item : (item && (item.name || item.title)) || '';
    }).filter(Boolean).join(', ');
  }
  if (value && typeof value === 'object') return text(value.name || value.title);
  return text(value);
}

function parseJson(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error('Некорректный JSON в файле плейлиста');
  }
  let items = data;
  if (!Array.isArray(items)) {
    items = data.tracks || data.items || data.songs || data.audios || data.entries || [];
  }
  if (!Array.isArray(items)) throw new Error('В JSON не найден массив треков');

  return items.map(function (item) {
    if (!item || typeof item !== 'object') return null;
    const title = firstValue(item, ['title', 'name', 'track', 'song', 'название']);
    const artist = jsonArtist(firstValue(item, ['artist', 'artists', 'performer', 'creator', 'author', 'исполнитель']));
    const location = firstValue(item, ['url', 'link', 'location', 'path', 'file', 'audio', 'src', 'ссылка', 'путь']);
    const album = firstValue(item, ['album', 'альбом']);
    const duration = firstValue(item, ['duration', 'length', 'time', 'длительность']);
    const meta = [artist, title].filter(Boolean).join(' - ');
    return {
      location: typeof location === 'string' ? location : '',
      meta: meta,
      album: typeof album === 'string' ? album : '',
      duration: parseTime(duration)
    };
  }).filter(function (entry) { return entry && (entry.location || entry.meta); });
}

function detectFormat(filePath, raw) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json' || /^\s*[\[{]/.test(raw)) return 'json';
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  if (ext === '.xspf' || /<playlist\b/i.test(raw)) return 'xspf';
  if (ext === '.pls' || /^\s*\[playlist\]/i.test(raw)) return 'pls';
  if (ext === '.m3u' || ext === '.m3u8' || /^\s*#EXTM3U/i.test(raw)) return 'm3u';
  if (/^[^\n]*[,;\t][^\n]*\n/.test(raw)) return 'csv';
  throw new Error('Не удалось распознать формат. Поддерживаются M3U, M3U8, PLS, XSPF, CSV и JSON');
}

function decodeLocation(value) {
  const raw = text(value).replace(/^["']|["']$/g, '');
  if (!raw) return null;
  if (/^file:\/\//i.test(raw)) {
    try {
      return { type: 'file', value: fileURLToPath(raw) };
    } catch (err) {
      return null;
    }
  }
  if (/^https?:\/\//i.test(raw)) return { type: 'url', value: raw };
  if (/^\/\//.test(raw)) return { type: 'url', value: 'https:' + raw };
  return { type: 'file', value: raw };
}

function providerFor(value) {
  if (/music\.yandex\./i.test(value)) return 'yandex';
  if (/vk\.com|vk\.ru/i.test(value)) return 'vk';
  if (/open\.spotify\.com/i.test(value)) return 'spotify';
  return 'link';
}

function isPlayableUrl(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  if (AUDIO_EXT.test(value)) return true;
  try {
    const host = new URL(value).hostname;
    if (PAGE_HOST.test(host)) return false;
    return /(^|\.)(archive\.org|ccmixter\.org|audius\.co|audius\.dev)$/i.test(host) ||
      /\/(stream|download|get-mp3|get-music|media|audio)(\/|$)/i.test(new URL(value).pathname);
  } catch (err) {
    return false;
  }
}

function buildTrack(entry, filePath, index) {
  const location = decodeLocation(entry.location);
  if (!location) return { warning: 'нет ссылки' };

  let audioPath = null;
  let url = null;
  if (location.type === 'file') {
    audioPath = path.isAbsolute(location.value)
      ? path.normalize(location.value)
      : path.resolve(path.dirname(filePath), location.value);
    if (!fs.existsSync(audioPath) || !fs.statSync(audioPath).isFile()) {
      return { warning: 'файл не найден: ' + path.basename(audioPath) };
    }
    if (!AUDIO_EXT.test(audioPath)) return { warning: 'не аудиофайл: ' + path.basename(audioPath) };
  } else {
    if (!isPlayableUrl(location.value)) {
      return { warning: 'ссылка на страницу сервиса, а не на аудиофайл' };
    }
    url = location.value;
  }

  const meta = splitArtistTitle(entry.meta);
  const fallbackName = audioPath
    ? path.basename(audioPath, path.extname(audioPath))
    : (function () {
      try {
        return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
      } catch (err) {
        return '';
      }
    })();
  const fallback = splitArtistTitle(fallbackName.replace(/[_+]+/g, ' '));
  const title = meta.title || fallback.title || 'Без названия';
  const artist = meta.artist || fallback.artist || 'Неизвестный исполнитель';
  const key = audioPath || url;
  const id = 'pl_' + sha1(key.toLowerCase()).slice(0, 24);

  return {
    track: {
      id: id,
      externalId: null,
      title: title,
      artist: artist,
      album: text(entry.album, ''),
      duration: Math.max(0, Number(entry.duration) || 0),
      url: url,
      path: audioPath,
      image: null,
      source: audioPath ? 'local' : 'link',
      provider: audioPath ? 'local' : providerFor(url)
    }
  };
}

function importPlaylistFile(filePath) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) throw new Error('Файл не найден');
  const raw = readText(absolute);
  const format = detectFormat(absolute, raw);
  let entries;
  if (format === 'json') entries = parseJson(raw);
  else if (format === 'csv') entries = parseCsv(raw);
  else if (format === 'xspf') entries = parseXspf(raw);
  else if (format === 'pls') entries = parsePLS(raw);
  else entries = parseM3U(raw);

  const tracks = [];
  const warnings = [];
  let skipped = 0;
  let seen = new Set();

  entries.slice(0, MAX_TRACKS).forEach(function (entry, index) {
    const result = buildTrack(entry, absolute, index);
    if (result.warning) {
      skipped++;
      if (warnings.length < 5) warnings.push(result.warning);
      return;
    }
    if (seen.has(result.track.id)) {
      skipped++;
      return;
    }
    seen.add(result.track.id);
    tracks.push(result.track);
  });

  if (entries.length > MAX_TRACKS) {
    warnings.push('Импортированы первые ' + MAX_TRACKS + ' треков из ' + entries.length);
  }
  if (!tracks.length) {
    const reason = skipped ? ' В файле нет прямых ссылок на аудиофайлы.' : '';
    throw new Error('В плейлисте не найдено треков.' + reason);
  }

  const name = path.basename(absolute, path.extname(absolute));
  const trackIds = tracks.map(function (track) { return track.id; });
  return {
    name: name,
    format: format,
    tracks: tracks,
    collection: {
      id: 'playlist_import_' + sha1(absolute.toLowerCase()).slice(0, 20),
      type: 'playlist',
      title: name,
      subtitle: tracks.length + ' треков · импорт из файла',
      image: null,
      trackIds: trackIds
    },
    skipped: skipped,
    warnings: warnings
  };
}

module.exports = {
  importPlaylistFile: importPlaylistFile,
  MAX_TRACKS: MAX_TRACKS
};
