/**
 * Легальные каталоги свободной музыки.
 *
 * Audius       — официальный API, только потоковое воспроизведение.
 * ccMixter     — Creative Commons, прямые MP3.
 * Internet Archive — только коллекции с указанной лицензией, прямые файлы.
 *
 * Модуль работает в main-процессе Electron: нет CORS, есть доступ к диску.
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const APP_NAME = 'Sonor';
const REQUEST_TIMEOUT = 20000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;
// ccMixter повторяет весь JSON в заголовке X-JSON — стандартных 16 КБ мало.
const MAX_HEADER_BYTES = 256 * 1024;
const SOURCES = ['all', 'audius', 'ccmixter', 'archive'];

const LABELS = {
  audius: 'Audius',
  ccmixter: 'ccMixter',
  archive: 'Internet Archive'
};

const HEADERS = {
  'User-Agent': 'Sonor/1.3 (Electron; +https://github.com/MyNameIsNikki/Sonor)',
  Accept: 'application/json, text/plain, */*'
};

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function requestBuffer(targetUrl, options, redirectsLeft) {
  const opts = options || {};
  const left = redirectsLeft === undefined ? 5 : redirectsLeft;

  return new Promise(function (resolve, reject) {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      reject(new Error('Некорректный адрес запроса'));
      return;
    }
    if (parsed.protocol !== 'https:') {
      reject(new Error('Разрешены только HTTPS-запросы'));
      return;
    }

    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        method: opts.method || 'GET',
        maxHeaderSize: MAX_HEADER_BYTES,
        headers: Object.assign({}, HEADERS, opts.headers || {})
      },
      function (res) {
        const status = res.statusCode || 0;

        if ([301, 302, 303, 307, 308].indexOf(status) !== -1 && res.headers.location) {
          res.resume();
          if (left <= 0) {
            reject(new Error('Слишком много перенаправлений'));
            return;
          }
          const next = new URL(res.headers.location, targetUrl).toString();
          resolve(requestBuffer(next, opts, left - 1));
          return;
        }

        if (status < 200 || status >= 300) {
          let errorBody = '';
          res.setEncoding('utf8');
          res.on('data', function (chunk) {
            if (errorBody.length < 800) errorBody += chunk;
          });
          res.on('end', function () {
            const clean = errorBody.replace(/\s+/g, ' ').slice(0, 240);
            reject(new Error('HTTP ' + status + (clean ? ': ' + clean : '')));
          });
          return;
        }

        const chunks = [];
        let size = 0;
        res.on('data', function (chunk) {
          size += chunk.length;
          if (size > MAX_JSON_BYTES) {
            req.destroy(new Error('Ответ API слишком большой'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', function () {
          resolve({ body: Buffer.concat(chunks), headers: res.headers, url: targetUrl });
        });
      }
    );

    req.setTimeout(REQUEST_TIMEOUT, function () {
      req.destroy(new Error('Превышено время ожидания ответа'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function getJson(targetUrl, headers) {
  const response = await requestBuffer(targetUrl, { headers: headers });
  const raw = response.body.toString('utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('Некорректный ответ API: ' + raw.replace(/\s+/g, ' ').slice(0, 160));
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
        results[index] = null;
      }
    }
  }

  const runners = [];
  const count = Math.min(limit, items.length);
  for (let i = 0; i < count; i++) runners.push(run());
  await Promise.all(runners);
  return results;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function text(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  return String(value).trim();
}

function parseDuration(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value > 0 ? value : 0;

  const raw = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw) || 0;

  const parts = raw.split(':').map(Number);
  if (parts.some(function (part) { return !isFinite(part); })) return 0;
  let seconds = 0;
  for (let i = 0; i < parts.length; i++) seconds = seconds * 60 + parts[i];
  return seconds;
}

function imageUrl(value) {
  const url = text(value);
  if (!url) return null;
  if (url.indexOf('//') === 0) return 'https:' + url;
  if (url.indexOf('http://') === 0) return 'https://' + url.slice(7);
  return url.indexOf('https://') === 0 ? url : null;
}

function escapeLucene(value) {
  return text(value)
    .replace(/[\\"()\[\]{}:^~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/* ------------------------------------------------------------------ */
/* Audius                                                              */
/* ------------------------------------------------------------------ */

function mapAudius(item) {
  if (!item || !item.id) return null;
  if (item.is_streamable === false || item.is_available === false || item.is_stream_gated === true) {
    return null;
  }

  const user = item.user || {};
  const artwork = item.artwork || {};
  const streamUrl = item.stream && item.stream.url ? item.stream.url : null;
  const permalink = text(item.permalink);
  const license = text(item.license) || 'Audius';

  // В разделе свободной музыки оставляем только треки с открытой лицензией.
  if (/all rights reserved/i.test(license)) return null;

  return {
    id: 'audius_' + item.id,
    externalId: String(item.id),
    title: text(item.title) || 'Без названия',
    artist: text(user.name) || text(user.handle) || 'Audius',
    album: text(item.genre) || 'Audius',
    duration: Number(item.duration) || 0,
    url: null,
    src: streamUrl,
    image:
      imageUrl(artwork['480x480']) ||
      imageUrl(artwork['1000x1000']) ||
      imageUrl(artwork['150x150']),
    source: 'audius',
    provider: 'audius',
    license: license,
    downloadable: false,
    streamOnly: true,
    filePageUrl: permalink ? 'https://audius.co' + (permalink.charAt(0) === '/' ? '' : '/') + permalink : null
  };
}

async function audiusSearch(query, limit) {
  const count = Math.min(Math.max(Number(limit) || 20, 1), 40);
  const url =
    'https://api.audius.co/v1/tracks/search?query=' +
    encodeURIComponent(query) +
    '&limit=' + count +
    '&app_name=' + encodeURIComponent(APP_NAME);

  const data = await getJson(url);
  const list = Array.isArray(data && data.data) ? data.data : [];
  return list.map(mapAudius).filter(Boolean);
}

function resolveRedirect(targetUrl, redirectsLeft) {
  const left = redirectsLeft === undefined ? 5 : redirectsLeft;
  return new Promise(function (resolve, reject) {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      reject(new Error('Некорректная ссылка на поток'));
      return;
    }
    if (parsed.protocol !== 'https:') {
      reject(new Error('Разрешены только HTTPS-ссылки'));
      return;
    }

    const req = https.get(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        maxHeaderSize: MAX_HEADER_BYTES,
        headers: HEADERS
      },
      function (res) {
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].indexOf(status) !== -1 && res.headers.location) {
          res.resume();
          if (left <= 0) {
            reject(new Error('Слишком много перенаправлений'));
            return;
          }
          resolve(resolveRedirect(new URL(res.headers.location, targetUrl).toString(), left - 1));
          return;
        }

        res.destroy();
        if (status >= 200 && status < 400) resolve(targetUrl);
        else reject(new Error('Поток недоступен: HTTP ' + status));
      }
    );

    req.setTimeout(REQUEST_TIMEOUT, function () {
      req.destroy(new Error('Превышено время ожидания потока'));
    });
    req.on('error', reject);
  });
}

async function resolveAudiusStream(id) {
  const trackId = text(id);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(trackId)) {
    throw new Error('Некорректный идентификатор Audius');
  }

  const data = await getJson(
    'https://api.audius.co/v1/tracks/' + encodeURIComponent(trackId) +
    '?app_name=' + encodeURIComponent(APP_NAME)
  );
  const track = data && data.data;
  if (!track) throw new Error('Трек Audius не найден');
  if (track.is_streamable === false || track.is_stream_gated === true) {
    throw new Error('Автор запретил потоковое воспроизведение этого трека');
  }

  const direct = track.stream && track.stream.url;
  if (direct) return direct;

  return resolveRedirect(
    'https://api.audius.co/v1/tracks/' + encodeURIComponent(trackId) +
    '/stream?app_name=' + encodeURIComponent(APP_NAME)
  );
}

/* ------------------------------------------------------------------ */
/* ccMixter                                                            */
/* ------------------------------------------------------------------ */

function ccmixterFile(upload) {
  const files = Array.isArray(upload.files) ? upload.files : [];
  let fallback = null;

  for (let i = 0; i < files.length; i++) {
    const file = files[i] || {};
    const url = text(file.download_url);
    const name = text(file.file_name);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (Number(file.file_rawsize) > MAX_DOWNLOAD_BYTES) continue;

    const mp3 = text(file.file_nicname).toLowerCase() === 'mp3' || /\.mp3$/i.test(name);
    if (mp3) return file;
    if (!fallback && /\.(ogg|flac|m4a)$/i.test(name)) fallback = file;
  }
  return fallback;
}

function mapCcmixter(upload) {
  if (!upload || !upload.upload_id) return null;

  const extra = upload.upload_extra || {};
  if (upload.nsfw === true || extra.nsfw === true || extra.nsfw === 'true') return null;

  const file = ccmixterFile(upload);
  if (!file) return null;

  const fileInfo = file.file_format_info || {};
  const duration = parseDuration(fileInfo.ps) || parseDuration(fileInfo.duration);
  const artist = text(upload.user_real_name) || text(upload.user_name) || 'ccMixter';
  const license = text(upload.license_name) || 'Creative Commons';

  return {
    id: 'ccmixter_' + upload.upload_id,
    externalId: String(upload.upload_id),
    title: text(upload.upload_name) || text(file.file_name) || 'Без названия',
    artist: artist,
    album: 'ccMixter',
    duration: duration,
    url: text(file.download_url),
    image: imageUrl(upload.user_avatar_url) || imageUrl(extra.cover) || null,
    source: 'ccmixter',
    provider: 'ccmixter',
    license: license,
    licenseUrl: imageUrl(upload.license_url) || null,
    downloadable: true,
    streamOnly: false,
    filePageUrl: text(upload.file_page_url) || null
  };
}

async function ccmixterSearch(query, limit) {
  const count = Math.min(Math.max(Number(limit) || 20, 1), 40);
  const url =
    'https://ccmixter.org/api/query?f=json&limit=' + count +
    '&search=' + encodeURIComponent(query);

  const data = await getJson(url);
  const list = Array.isArray(data) ? data : (Array.isArray(data && data.results) ? data.results : []);
  return list.map(mapCcmixter).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Internet Archive                                                    */
/* ------------------------------------------------------------------ */

function archiveDirectUrl(identifier, fileName) {
  const encodedName = String(fileName)
    .split('/')
    .map(function (part) { return encodeURIComponent(part); })
    .join('/');
  return 'https://archive.org/download/' + encodeURIComponent(identifier) + '/' + encodedName;
}

function archiveFiles(files) {
  const allowed = /\.(mp3|ogg|flac|m4a|opus)$/i;
  const list = (Array.isArray(files) ? files : [])
    .filter(function (file) {
      if (!file || !file.name || !allowed.test(file.name)) return false;
      if (/spectrogram|__ia_thumb|_sample/i.test(file.name)) return false;
      const size = Number(file.size) || 0;
      return !size || size <= MAX_DOWNLOAD_BYTES;
    })
    .map(function (file) {
      const lower = String(file.name).toLowerCase();
      let score = 0;
      if (/\.mp3$/i.test(lower)) score += 4;
      if (String(file.source).toLowerCase() === 'original') score += 3;
      if (/vbr/i.test(String(file.format))) score += 1;
      return { file: file, score: score };
    })
    .sort(function (a, b) { return b.score - a.score; });

  const seen = {};
  const chosen = [];
  for (let i = 0; i < list.length && chosen.length < 2; i++) {
    const file = list[i].file;
    const base = String(file.name).replace(/\.[^.]+$/, '').toLowerCase();
    if (seen[base]) continue;
    seen[base] = true;
    chosen.push(file);
  }
  return chosen;
}

async function archiveItem(doc) {
  if (!doc || !doc.identifier) return [];
  const identifier = text(doc.identifier);
  if (!/^[A-Za-z0-9._-]+$/.test(identifier)) return [];

  let metadata;
  try {
    metadata = await getJson('https://archive.org/metadata/' + encodeURIComponent(identifier));
  } catch (err) {
    return [];
  }

  const info = metadata && metadata.metadata ? metadata.metadata : {};
  const licenseUrl = imageUrl(info.licenseurl) || imageUrl(doc.licenseurl);
  if (!licenseUrl) return [];

  const files = archiveFiles(metadata.files);
  if (!files.length) return [];

  const artist = text(info.creator) || text(doc.creator) || 'Internet Archive';
  const album = text(info.title) || text(doc.title) || 'Internet Archive';
  const image = 'https://archive.org/services/img/' + encodeURIComponent(identifier);

  return files.map(function (file, index) {
    const title = text(file.title) || (files.length > 1
      ? album + ' · ' + (index + 1)
      : album);
    return {
      id: 'archive_' + identifier + '_' + index,
      externalId: identifier + '/' + file.name,
      title: title,
      artist: artist,
      album: album,
      duration: parseDuration(file.length),
      url: archiveDirectUrl(identifier, file.name),
      image: image,
      source: 'archive',
      provider: 'archive',
      license: licenseUrl,
      licenseUrl: licenseUrl,
      downloadable: true,
      streamOnly: false,
      filePageUrl: 'https://archive.org/details/' + encodeURIComponent(identifier)
    };
  });
}

async function archiveSearch(query, limit) {
  const count = Math.min(Math.max(Number(limit) || 6, 1), 8);
  const cleaned = escapeLucene(query);
  const terms = cleaned
    ? cleaned.split(' ').filter(Boolean).map(function (word) { return word; }).join(' AND ')
    : '';
  const lucene =
    '(mediatype:audio AND collection:opensource_audio AND format:MP3 AND licenseurl:*)' +
    (terms ? ' AND (' + terms + ')' : '');

  const url =
    'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(lucene) +
    '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl' +
    '&rows=' + count + '&page=1&output=json&sort[]=' +
    encodeURIComponent('downloads desc');

  const data = await getJson(url);
  const docs = data && data.response && Array.isArray(data.response.docs)
    ? data.response.docs
    : [];

  if (!docs.length) return [];
  const groups = await mapLimit(docs, 3, archiveItem);
  return groups.reduce(function (all, group) {
    return all.concat(group || []);
  }, []);
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

async function searchFreeMusic(query, source) {
  const cleaned = text(query).slice(0, 80) || 'lofi';
  const selected = SOURCES.indexOf(source) !== -1 ? source : 'all';
  const jobs = [];

  if (selected === 'all' || selected === 'audius') {
    jobs.push({ key: 'audius', run: function () { return audiusSearch(cleaned, 18); } });
  }
  if (selected === 'all' || selected === 'ccmixter') {
    jobs.push({ key: 'ccmixter', run: function () { return ccmixterSearch(cleaned, 18); } });
  }
  if (selected === 'all' || selected === 'archive') {
    jobs.push({ key: 'archive', run: function () { return archiveSearch(cleaned, 6); } });
  }

  const settled = await Promise.allSettled(jobs.map(function (job) { return job.run(); }));
  const tracks = [];
  const warnings = [];
  const counts = {};

  settled.forEach(function (result, index) {
    const key = jobs[index].key;
    if (result.status === 'fulfilled') {
      const list = Array.isArray(result.value) ? result.value : [];
      counts[key] = list.length;
      tracks.push.apply(tracks, list);
    } else {
      counts[key] = 0;
      const message = result.reason && result.reason.message ? result.reason.message : String(result.reason);
      warnings.push(LABELS[key] + ': ' + message);
    }
  });

  if (settled.length && settled.every(function (result) { return result.status === 'rejected'; })) {
    throw new Error('Каталоги сейчас недоступны. Проверьте интернет и попробуйте ещё раз.');
  }

  const seen = {};
  const unique = [];
  tracks.forEach(function (track) {
    if (!track || !track.id || seen[track.id]) return;
    seen[track.id] = true;
    unique.push(track);
  });

  // Перемешиваем каталоги, чтобы в начале списка были и стриминг, и файлы.
  const buckets = {};
  unique.forEach(function (track) {
    if (!buckets[track.source]) buckets[track.source] = [];
    buckets[track.source].push(track);
  });
  const order = ['audius', 'ccmixter', 'archive'].filter(function (key) {
    return buckets[key] && buckets[key].length;
  });
  const mixed = [];
  let cursor = 0;
  while (mixed.length < unique.length && cursor < 1000) {
    let added = false;
    for (let i = 0; i < order.length; i++) {
      const bucket = buckets[order[i]];
      if (bucket[cursor]) {
        mixed.push(bucket[cursor]);
        added = true;
      }
    }
    if (!added) break;
    cursor++;
  }

  return {
    tracks: mixed.slice(0, 60),
    warnings: warnings,
    counts: counts,
    query: cleaned,
    source: selected
  };
}

/* ------------------------------------------------------------------ */
/* Download                                                            */
/* ------------------------------------------------------------------ */

function isAllowedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'ccmixter.org' ||
    host.endsWith('.ccmixter.org') ||
    host === 'archive.org' ||
    host.endsWith('.archive.org');
}

function safeName(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 110) || 'track';
}

function extensionFromUrl(targetUrl) {
  try {
    const ext = path.extname(new URL(targetUrl).pathname).toLowerCase();
    return ['.mp3', '.ogg', '.flac', '.m4a', '.opus', '.wav'].indexOf(ext) !== -1 ? ext : '.mp3';
  } catch (err) {
    return '.mp3';
  }
}

async function unusedPath(directory, baseName, extension) {
  let candidate = path.join(directory, baseName + extension);
  let counter = 2;
  while (true) {
    try {
      await fs.promises.access(candidate);
      candidate = path.join(directory, baseName + ' (' + counter + ')' + extension);
      counter++;
    } catch (err) {
      return candidate;
    }
  }
}

function isCcmixterHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'ccmixter.org' || host.endsWith('.ccmixter.org');
}

function streamToFile(targetUrl, partPath, redirectsLeft) {
  const left = redirectsLeft === undefined ? 6 : redirectsLeft;

  return new Promise(function (resolve, reject) {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      reject(new Error('Некорректная ссылка на файл'));
      return;
    }
    if (parsed.protocol !== 'https:' || !isAllowedHost(parsed.hostname)) {
      reject(new Error('Скачивание с этого источника запрещено'));
      return;
    }

    const req = https.get(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Sonor/1.3',
          Accept: 'audio/*, application/octet-stream, */*',
          Referer: isCcmixterHost(parsed.hostname) ? 'https://ccmixter.org/' : 'https://archive.org/'
        }
      },
      function (res) {
        const status = res.statusCode || 0;

        if ([301, 302, 303, 307, 308].indexOf(status) !== -1 && res.headers.location) {
          res.resume();
          if (left <= 0) {
            reject(new Error('Слишком много перенаправлений при скачивании'));
            return;
          }
          const next = new URL(res.headers.location, targetUrl).toString();
          resolve(streamToFile(next, partPath, left - 1));
          return;
        }

        if (status !== 200) {
          res.resume();
          reject(new Error('Сервер вернул HTTP ' + status));
          return;
        }

        const contentType = String(res.headers['content-type'] || '');
        if (/text\/html/i.test(contentType)) {
          res.resume();
          reject(new Error('Сервер вернул страницу вместо аудиофайла'));
          return;
        }

        const declared = Number(res.headers['content-length']) || 0;
        if (declared > MAX_DOWNLOAD_BYTES) {
          res.resume();
          reject(new Error('Файл больше 300 МБ'));
          return;
        }

        let bytes = 0;
        let failed = false;
        const output = fs.createWriteStream(partPath);

        res.on('data', function (chunk) {
          bytes += chunk.length;
          if (bytes > MAX_DOWNLOAD_BYTES && !failed) {
            failed = true;
            req.destroy();
            output.destroy();
            reject(new Error('Файл больше 300 МБ'));
          }
        });
        res.on('error', function (err) {
          if (!failed) {
            failed = true;
            output.destroy();
            reject(err);
          }
        });
        output.on('error', function (err) {
          if (!failed) {
            failed = true;
            reject(err);
          }
        });
        output.on('finish', function () {
          if (failed) return;
          if (!bytes) {
            reject(new Error('Файл пустой'));
            return;
          }
          resolve({ size: bytes, finalUrl: targetUrl });
        });

        res.pipe(output);
      }
    );

    req.setTimeout(60000, function () {
      req.destroy(new Error('Превышено время ожидания скачивания'));
    });
    req.on('error', function (err) {
      if (!req.destroyed || !/socket hang up/i.test(String(err && err.message))) reject(err);
    });
  });
}

async function downloadFreeTrack(targetUrl, destDir, meta) {
  const info = meta || {};
  if (text(info.source) === 'audius') {
    throw new Error('Audius разрешает только прослушивание, без скачивания');
  }

  let parsed;
  try {
    parsed = new URL(text(targetUrl));
  } catch (err) {
    throw new Error('Некорректная ссылка на скачивание');
  }
  if (parsed.protocol !== 'https:' || !isAllowedHost(parsed.hostname)) {
    throw new Error('Скачивание доступно только с ccMixter и Internet Archive');
  }

  const extension = extensionFromUrl(targetUrl);
  const baseName = safeName(
    (text(info.artist) ? text(info.artist) + ' - ' : '') + (text(info.title) || 'track')
  );
  const target = await unusedPath(destDir, baseName, extension);
  const part = target + '.part';

  await fs.promises.mkdir(destDir, { recursive: true });

  try {
    const result = await streamToFile(targetUrl, part);
    await fs.promises.rename(part, target);
    return { path: target, size: result.size, name: path.basename(target) };
  } catch (err) {
    await fs.promises.unlink(part).catch(function () {});
    throw err;
  }
}

module.exports = {
  searchFreeMusic: searchFreeMusic,
  resolveAudiusStream: resolveAudiusStream,
  downloadFreeTrack: downloadFreeTrack,
  MAX_DOWNLOAD_BYTES: MAX_DOWNLOAD_BYTES
};
