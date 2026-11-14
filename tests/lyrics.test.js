'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  buildLyricsResult,
  normalizeQuery,
  parseLrc,
  pickBestCandidate,
  stripTimestamps
} = require('../src/services/lyricsCore');

test('parseLrc разбирает метки времени и несколько меток на строку', () => {
  const lines = parseLrc([
    '[ar:Исполнитель]',
    '[ti:Название]',
    '[00:12.34]Первая строка',
    '[00:15.00][01:02.50]Припев',
    '[offset:+200]'
  ].join('\n'));

  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0].time, 12.34);
  assert.strictEqual(lines[0].text, 'Первая строка');
  assert.strictEqual(lines[1].time, 15);
  assert.strictEqual(lines[1].text, 'Припев');
  assert.strictEqual(lines[2].time, 62.5);
  assert.strictEqual(lines[2].text, 'Припев');
});

test('parseLrc понимает десятые и тысячные доли секунды', () => {
  const lines = parseLrc('[00:01.5]Раз\n[00:02.050]Два\n[00:03.123]Три');
  assert.deepStrictEqual(lines.map((line) => line.time), [1.5, 2.05, 3.123]);
});

test('parseLrc возвращает пустой список для обычного текста', () => {
  assert.deepStrictEqual(parseLrc('Просто текст\nБез времени'), []);
  assert.deepStrictEqual(parseLrc(''), []);
});

test('buildLyricsResult выбирает синхронизированный текст', () => {
  const result = buildLyricsResult({
    trackName: 'Песня',
    artistName: 'Артист',
    syncedLyrics: '[00:01.00]Раз\n[00:02.00]Два',
    plainLyrics: 'Раз\nДва'
  });

  assert.strictEqual(result.found, true);
  assert.strictEqual(result.synced, true);
  assert.strictEqual(result.lines.length, 2);
  assert.strictEqual(result.plain, 'Раз\nДва');
  assert.strictEqual(result.attribution, 'LRCLib');
});

test('buildLyricsResult поддерживает обычный текст и инструментал', () => {
  const plain = buildLyricsResult({ plainLyrics: 'Строка один\nСтрока два' });
  assert.strictEqual(plain.found, true);
  assert.strictEqual(plain.synced, false);
  assert.strictEqual(plain.lines.length, 0);

  const instrumental = buildLyricsResult({ instrumental: true });
  assert.strictEqual(instrumental.found, true);
  assert.strictEqual(instrumental.instrumental, true);
  assert.strictEqual(instrumental.plain, '');
});

test('buildLyricsResult возвращает not found для пустого кандидата', () => {
  const result = buildLyricsResult(null);
  assert.strictEqual(result.found, false);
  assert.strictEqual(result.synced, false);
  assert.deepStrictEqual(result.lines, []);
});

test('normalizeQuery очищает название и создаёт варианты поиска', () => {
  const query = normalizeQuery({
    title: 'Песня (feat. Друг) - Remastered 2024',
    artist: 'Артист · OST',
    album: 'Альбом',
    duration: 215000
  });

  assert.strictEqual(query.artist, 'Артист');
  assert.strictEqual(query.duration, 215);
  assert.ok(query.titleVariants.indexOf('Песня (feat. Друг) - Remastered 2024') !== -1);
  assert.ok(query.titleVariants.indexOf('Песня - Remastered 2024') !== -1);
  assert.ok(query.titleVariants.indexOf('Песня') !== -1);
});

test('pickBestCandidate предпочитает синхронизацию и близкую длительность', () => {
  const query = normalizeQuery({ title: 'Песня', artist: 'Артист', duration: 215 });
  const best = pickBestCandidate([
    { id: 1, trackName: 'Песня', artistName: 'Артист', duration: 215, plainLyrics: 'Текст' },
    { id: 2, trackName: 'Песня', artistName: 'Артист', duration: 214, syncedLyrics: '[00:01.00]Текст' },
    { id: 3, trackName: 'Другая', artistName: 'Кто-то', duration: 300, syncedLyrics: '[00:01.00]Другое' }
  ], query);

  assert.strictEqual(best.id, 2);
});

test('stripTimestamps убирает служебные метки', () => {
  assert.strictEqual(
    stripTimestamps('[00:01.00]Раз\n[00:02.50]Два'),
    'Раз\nДва'
  );
});
