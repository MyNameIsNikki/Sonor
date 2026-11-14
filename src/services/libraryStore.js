/**
 * Чистые функции хранения библиотеки: санитайзеры для library.json.
 * Не зависят от Electron — используются main-процессом и тестируются
 * напрямую (node --test tests/).
 */
'use strict';

/* Лайки и статистика прослушиваний живут отдельно от треков: импорт
 * пересоздаёт объекты треков, а история и сердечки должны переживать его. */
function emptyStats() {
  return { likes: {}, plays: {}, lastPlayed: {}, history: [] };
}

function sanitizeTrack(track) {
  if (!track || !track.id) return null;
  return {
    id: String(track.id),
    externalId: track.externalId ? String(track.externalId) : null,
    title: String(track.title || 'Без названия'),
    artist: String(track.artist || 'Неизвестный исполнитель'),
    album: String(track.album || ''),
    duration: Number(track.duration) || 0,
    url: track.url || null,
    path: track.path ? String(track.path) : null,
    image: track.image || null,
    source: String(track.source || ''),
    provider: track.provider ? String(track.provider) : null,
    origin: track.origin ? String(track.origin) : null,
    public: track.public === true,
    license: track.license ? String(track.license).slice(0, 240) : null,
    licenseUrl: track.licenseUrl ? String(track.licenseUrl) : null,
    filePageUrl: track.filePageUrl ? String(track.filePageUrl) : null,
    downloadable: track.downloadable === true,
    streamOnly: track.streamOnly === true
  };
}

function sanitizeCollection(collection) {
  if (!collection || !collection.id) return null;
  return {
    id: String(collection.id),
    source: String(collection.source || ''),
    type: String(collection.type || 'playlist'),
    title: String(collection.title || 'Без названия'),
    subtitle: String(collection.subtitle || ''),
    image: collection.image || null,
    trackIds: Array.isArray(collection.trackIds)
      ? collection.trackIds.slice(0, 20000).map(String)
      : []
  };
}

function sanitizeStats(input) {
  const source = input && typeof input === 'object' ? input : {};
  const likes = {};
  if (source.likes && typeof source.likes === 'object') {
    Object.keys(source.likes).slice(0, 20000).forEach(function (id) {
      if (source.likes[id]) likes[String(id).slice(0, 200)] = true;
    });
  }
  const plays = {};
  if (source.plays && typeof source.plays === 'object') {
    Object.keys(source.plays).slice(0, 20000).forEach(function (id) {
      const value = Number(source.plays[id]);
      if (value > 0) plays[String(id).slice(0, 200)] = Math.min(Math.round(value), 1000000);
    });
  }
  const lastPlayed = {};
  if (source.lastPlayed && typeof source.lastPlayed === 'object') {
    Object.keys(source.lastPlayed).slice(0, 20000).forEach(function (id) {
      const value = new Date(source.lastPlayed[id]);
      if (!isNaN(value.getTime())) lastPlayed[String(id).slice(0, 200)] = value.toISOString();
    });
  }
  const history = Array.isArray(source.history)
    ? source.history.slice(0, 500)
      .map(function (item) {
        const at = new Date(item && item.at);
        return item && item.id && !isNaN(at.getTime())
          ? { id: String(item.id).slice(0, 200), at: at.toISOString() }
          : null;
      })
      .filter(Boolean)
    : [];
  return { likes: likes, plays: plays, lastPlayed: lastPlayed, history: history };
}

function sanitizeLibrary(input) {
  const data = input && typeof input === 'object' ? input : {};
  const tracks = Array.isArray(data.tracks)
    ? data.tracks.slice(0, 20000).map(sanitizeTrack).filter(Boolean)
    : [];
  const collections = Array.isArray(data.collections)
    ? data.collections.slice(0, 2000).map(sanitizeCollection).filter(Boolean)
    : [];
  return {
    version: 1,
    tracks: tracks,
    collections: collections,
    stats: sanitizeStats(data.stats),
    savedAt: new Date().toISOString()
  };
}

module.exports = {
  emptyStats: emptyStats,
  sanitizeTrack: sanitizeTrack,
  sanitizeCollection: sanitizeCollection,
  sanitizeStats: sanitizeStats,
  sanitizeLibrary: sanitizeLibrary
};
