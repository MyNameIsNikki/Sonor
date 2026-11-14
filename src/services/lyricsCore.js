'use strict';

// Чистые функции для текстов песен: разбор LRC, нормализация запроса и
// выбор лучшего результата. Модуль не зависит от Electron и React Native,
// поэтому используется и на ПК, и на телефоне, и покрывается тестами.

const MAX_FIELD = 240;

function clean(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FIELD);
}

function normalizeForMatch(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeQuery(input) {
  const source = input || {};
  const title = clean(source.title);
  const artist = clean(source.artist).replace(/\s*[·|]\s*.*$/, '');
  const album = clean(source.album);
  let duration = Number(source.duration);
  if (!Number.isFinite(duration) || duration <= 0) duration = 0;
  if (duration > 1000) duration = duration / 1000;

  const variants = [];
  if (title) variants.push(title);

  const withoutBrackets = title
    .replace(/\s*[\(\[][^)\]]{0,80}[\)\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutBrackets && withoutBrackets !== title) variants.push(withoutBrackets);

  const withoutVersion = withoutBrackets
    .replace(/\s+-\s+(remaster(ed)?|live|radio edit|single version|album version|bonus track|demo).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutVersion && variants.indexOf(withoutVersion) === -1) variants.push(withoutVersion);

  return {
    title,
    artist,
    album,
    duration,
    titleVariants: variants
  };
}

// Разбирает LRC. Поддерживает несколько меток времени на строку,
// сотые/десятые доли секунды и служебные теги [ar:], [ti:], [offset:].
function parseLrc(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw)
    .replace(/\r\n?/g, '\n');
  const lines = [];
  const timeTag = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  text.split('\n').forEach(function (line) {
    if (/^\s*\[(ar|ti|al|by|offset|re|ve|length):/i.test(line)) return;

    timeTag.lastIndex = 0;
    const times = [];
    let match;
    while ((match = timeTag.exec(line))) {
      const minutes = Number(match[1]) || 0;
      const seconds = Number(match[2]) || 0;
      const fraction = match[3] || '';
      let milliseconds = 0;
      if (fraction.length === 1) milliseconds = Number(fraction) * 100;
      else if (fraction.length === 2) milliseconds = Number(fraction) * 10;
      else if (fraction.length === 3) milliseconds = Number(fraction);
      if (seconds >= 60) continue;
      times.push(minutes * 60 + seconds + milliseconds / 1000);
    }

    if (!times.length) return;

    const lyric = line
      .replace(timeTag, '')
      .replace(/\[[a-z]+:[^\]]*\]/gi, '')
      .trim();

    times.forEach(function (time) {
      lines.push({ time: Math.max(0, Math.round(time * 1000) / 1000), text: lyric });
    });
  });

  lines.sort(function (a, b) { return a.time - b.time; });
  return lines;
}

function stripTimestamps(raw) {
  return String(raw === undefined || raw === null ? '' : raw)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(function (line) {
      return line.replace(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g, '').trim();
    })
    .filter(Boolean)
    .join('\n');
}

function buildLyricsResult(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return {
      found: false,
      synced: false,
      instrumental: false,
      lines: [],
      plain: '',
      attribution: 'LRCLib',
      sourceUrl: 'https://lrclib.net'
    };
  }

  const syncedRaw = String(candidate.syncedLyrics || '');
  const plain = String(candidate.plainLyrics || '').replace(/\r\n?/g, '\n').trim();
  const lines = syncedRaw ? parseLrc(syncedRaw) : [];
  const instrumental = candidate.instrumental === true;

  if (lines.length) {
    return {
      found: true,
      synced: true,
      instrumental: instrumental,
      lines: lines,
      plain: plain || stripTimestamps(syncedRaw),
      trackName: clean(candidate.trackName),
      artistName: clean(candidate.artistName),
      albumName: clean(candidate.albumName),
      duration: Number(candidate.duration) || 0,
      attribution: 'LRCLib',
      sourceUrl: 'https://lrclib.net'
    };
  }

  if (plain || instrumental) {
    return {
      found: true,
      synced: false,
      instrumental: instrumental,
      lines: [],
      plain: plain,
      trackName: clean(candidate.trackName),
      artistName: clean(candidate.artistName),
      albumName: clean(candidate.albumName),
      duration: Number(candidate.duration) || 0,
      attribution: 'LRCLib',
      sourceUrl: 'https://lrclib.net'
    };
  }

  return {
    found: false,
    synced: false,
    instrumental: false,
    lines: [],
    plain: '',
    attribution: 'LRCLib',
    sourceUrl: 'https://lrclib.net'
  };
}

function scoreCandidate(candidate, query) {
  if (!candidate) return -Infinity;
  let score = 0;

  if (candidate.syncedLyrics && parseLrc(candidate.syncedLyrics).length) score += 100;
  else if (candidate.plainLyrics) score += 25;
  else if (candidate.instrumental) score += 10;
  else return -Infinity;

  const candidateTitle = normalizeForMatch(candidate.trackName);
  const queryTitle = normalizeForMatch(query.title);
  if (queryTitle && candidateTitle === queryTitle) score += 45;
  else if (queryTitle && candidateTitle && (candidateTitle.indexOf(queryTitle) !== -1 || queryTitle.indexOf(candidateTitle) !== -1)) score += 18;

  const candidateArtist = normalizeForMatch(candidate.artistName);
  const queryArtist = normalizeForMatch(query.artist);
  if (queryArtist && candidateArtist === queryArtist) score += 35;
  else if (queryArtist && candidateArtist && (candidateArtist.indexOf(queryArtist) !== -1 || queryArtist.indexOf(candidateArtist) !== -1)) score += 12;

  if (query.album && normalizeForMatch(candidate.albumName) === normalizeForMatch(query.album)) score += 8;

  if (query.duration && candidate.duration) {
    const diff = Math.abs(Number(candidate.duration) - query.duration);
    if (diff <= 2) score += 55;
    else if (diff <= 5) score += 28;
    else if (diff <= 10) score += 8;
    else if (diff > 20) score -= 35;
  }

  return score;
}

function pickBestCandidate(list, query) {
  if (!Array.isArray(list) || !list.length) return null;
  let best = null;
  let bestScore = -Infinity;
  list.forEach(function (candidate) {
    const score = scoreCandidate(candidate, query);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return bestScore === -Infinity ? null : best;
}

module.exports = {
  buildLyricsResult,
  normalizeForMatch,
  normalizeQuery,
  parseLrc,
  pickBestCandidate,
  stripTimestamps
};
