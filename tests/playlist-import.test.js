// Тесты импорта файлов плейлистов (src/services/playlistImport.js)
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { importPlaylistFile } = require('../src/services/playlistImport');

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonor-test-'));
  // Фейковый «аудио»-файл, на который ссылаются плейлисты
  fs.writeFileSync(path.join(dir, 'Трек - Один.mp3'), Buffer.alloc(128));
  fs.writeFileSync(path.join(dir, 'Трек - Два.mp3'), Buffer.alloc(128));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function abs(name) {
  return path.join(dir, name);
}

test('M3U: EXTINF даёт исполнителя и название, дубли пропускаются', () => {
  fs.writeFileSync(abs('a.m3u'), [
    '#EXTM3U',
    '#EXTINF:180,Артист - Название',
    abs('Трек - Один.mp3'),
    abs('Трек - Один.mp3')
  ].join('\n'));
  const r = importPlaylistFile(abs('a.m3u'));
  assert.strictEqual(r.tracks.length, 1);
  assert.strictEqual(r.skipped, 1);
  assert.strictEqual(r.tracks[0].title, 'Название');
  assert.strictEqual(r.tracks[0].artist, 'Артист');
  assert.strictEqual(r.tracks[0].duration, 180);
  assert.strictEqual(r.tracks[0].source, 'local');
  assert.ok(r.collection);
});

test('M3U: относительные пути разрешаются от папки плейлиста', () => {
  fs.writeFileSync(abs('b.m3u'), 'Трек - Два.mp3\n');
  const r = importPlaylistFile(abs('b.m3u'));
  assert.strictEqual(r.tracks.length, 1);
  assert.strictEqual(r.tracks[0].path, abs('Трек - Два.mp3'));
});

test('РЕГРЕССИЯ: PLS-файл (начинается с «[») не должен парситься как JSON', () => {
  // В версии 1.6.0 detectFormat проверял JSON раньше PLS — любые .pls падали
  fs.writeFileSync(abs('c.pls'), [
    '[playlist]',
    'File1=' + abs('Трек - Один.mp3'),
    'Title1=PLS трек',
    'NumberOfEntries=1',
    'Version=2'
  ].join('\n'));
  const r = importPlaylistFile(abs('c.pls'));
  assert.strictEqual(r.tracks.length, 1);
  assert.strictEqual(r.tracks[0].title, 'PLS трек');
});

test('РЕГРЕССИЯ: XSPF вызывает существующий парсер (опечатка parseXspf в 1.6.0)', () => {
  const fileUrl = 'file:///' + abs('Трек - Один.mp3').split(path.sep).join('/');
  fs.writeFileSync(abs('d.xspf'),
    '<?xml version="1.0"?><playlist><trackList><track>' +
    '<location>' + fileUrl + '</location>' +
    '<title>XSPF трек</title><creator>X</creator><duration>95000</duration>' +
    '</track></trackList></playlist>');
  const r = importPlaylistFile(abs('d.xspf'));
  assert.strictEqual(r.tracks.length, 1);
  assert.strictEqual(r.tracks[0].title, 'XSPF трек');
  assert.strictEqual(r.tracks[0].artist, 'X');
});

test('CSV: заголовок url,title,artist', () => {
  fs.writeFileSync(abs('e.csv'), 'url,title,artist\n' + abs('Трек - Два.mp3') + ',CSV трек,Кто-то\n');
  const r = importPlaylistFile(abs('e.csv'));
  assert.strictEqual(r.tracks.length, 1);
  assert.strictEqual(r.tracks[0].title, 'CSV трек');
  assert.strictEqual(r.tracks[0].artist, 'Кто-то');
});

test('JSON: массив {url, title}', () => {
  fs.writeFileSync(abs('f.json'), JSON.stringify([{ url: abs('Трек - Один.mp3'), title: 'JSON трек' }]));
  const r = importPlaylistFile(abs('f.json'));
  assert.strictEqual(r.tracks.length, 1);
  assert.strictEqual(r.tracks[0].title, 'JSON трек');
});

test('Незнакомый формат даёт понятную ошибку', () => {
  fs.writeFileSync(abs('g.txt'), 'это вообще не плейлист');
  assert.throws(() => importPlaylistFile(abs('g.txt')), /Не удалось распознать формат/);
});

test('Отсутствующий файл: ошибку «Файл не найден»', () => {
  assert.throws(() => importPlaylistFile(abs('нет-такого.m3u')), /Файл не найден/);
});

test('Ссылки на несуществующие аудио попадают в skipped, а не падают', () => {
  fs.writeFileSync(abs('h.m3u'), abs('нет-файла.mp3') + '\n' + abs('Трек - Один.mp3') + '\n');
  const r = importPlaylistFile(abs('h.m3u'));
  assert.strictEqual(r.tracks.length, 1);
  assert.strictEqual(r.skipped, 1);
});
