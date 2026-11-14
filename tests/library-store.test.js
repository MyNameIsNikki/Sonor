// Тесты санитайзеров библиотеки (src/services/libraryStore.js)
const { test } = require('node:test');
const assert = require('node:assert');
const store = require('../src/services/libraryStore');

test('sanitizeTrack выбрасывает трек без id', () => {
  assert.strictEqual(store.sanitizeTrack(null), null);
  assert.strictEqual(store.sanitizeTrack({ title: 'x' }), null);
});

test('sanitizeTrack оставляет только whitelisted поля', () => {
  const t = store.sanitizeTrack({
    id: 't1',
    title: 'Песня',
    artist: 'Артист',
    // Посторонние поля должны исчезнуть:
    src: 'blob:xxx',
    token: 'secret',
    extra: true
  });
  assert.strictEqual(t.title, 'Песня');
  assert.strictEqual(t.artist, 'Артист');
  assert.ok(!('src' in t));
  assert.ok(!('token' in t));
  assert.ok(!('extra' in t));
});

test('sanitizeTrack подставляет значения по умолчанию', () => {
  const t = store.sanitizeTrack({ id: 'x' });
  assert.strictEqual(t.title, 'Без названия');
  assert.strictEqual(t.artist, 'Неизвестный исполнитель');
  assert.strictEqual(t.duration, 0);
  assert.strictEqual(t.public, false);
  assert.strictEqual(t.url, null);
});

test('sanitizeTrack: public только при строгом true', () => {
  assert.strictEqual(store.sanitizeTrack({ id: 'a', public: true }).public, true);
  assert.strictEqual(store.sanitizeTrack({ id: 'b', public: 'yes' }).public, false);
});

test('sanitizeCollection: id обязателен, trackIds мапятся в строки', () => {
  assert.strictEqual(store.sanitizeCollection(null), null);
  assert.strictEqual(store.sanitizeCollection({ title: 'нет id' }), null);
  const c = store.sanitizeCollection({ id: 7, trackIds: [1, 2, 'x'] });
  assert.strictEqual(c.id, '7');
  assert.deepStrictEqual(c.trackIds, ['1', '2', 'x']);
  assert.strictEqual(c.type, 'playlist');
});

test('sanitizeStats: только правдивые лайки, целые положительные счётчики', () => {
  const stats = store.sanitizeStats({
    likes: { a: true, b: false, c: 1 },
    plays: { a: 3.7, b: -2, c: 0, d: 'x' },
    lastPlayed: { a: '2026-11-09T10:00:00Z', b: 'мусор' },
    history: [{ id: 'a', at: 1762000000000 }, { id: null }, { id: 'b', at: 'нет даты' }]
  });
  assert.deepStrictEqual(stats.likes, { a: true, c: true });
  assert.deepStrictEqual(stats.plays, { a: 4 });
  assert.ok(stats.lastPlayed.a);
  assert.ok(!('b' in stats.lastPlayed));
  assert.strictEqual(stats.history.length, 1);
  assert.strictEqual(stats.history[0].id, 'a');
});

test('sanitizeStats: пустой или мусорный вход даёт пустую структуру', () => {
  for (const bad of [undefined, null, 'x', 42, []]) {
    const s = store.sanitizeStats(bad);
    assert.deepStrictEqual(s, { likes: {}, plays: {}, lastPlayed: {}, history: [] });
  }
});

test('sanitizeLibrary: нормализует полный payload и переживает мусор', () => {
  const good = store.sanitizeLibrary({
    tracks: [{ id: 't1', title: 'A' }, { title: 'нет id' }],
    collections: [{ id: 'c1', trackIds: ['t1'] }],
    stats: { likes: { t1: true } }
  });
  assert.strictEqual(good.version, 1);
  assert.strictEqual(good.tracks.length, 1);
  assert.strictEqual(good.collections.length, 1);
  assert.strictEqual(good.stats.likes.t1, true);
  assert.ok(good.savedAt);

  const bad = store.sanitizeLibrary('мусор');
  assert.deepStrictEqual(bad.tracks, []);
  assert.deepStrictEqual(bad.collections, []);
  assert.deepStrictEqual(bad.stats, { likes: {}, plays: {}, lastPlayed: {}, history: [] });
});
