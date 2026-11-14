// Тесты внутренних помощников импортёров (src/services/importers.js)
const { test } = require('node:test');
const assert = require('node:assert');
const { __testables } = require('../src/services/importers');

const { splitArtistTitle, nameFromUrl, parseM3U, parsePLS, parseXSPF, spotifyEmbedEntity, yandexImage } = __testables;

/* ---------- splitArtistTitle ---------- */

test('splitArtistTitle: «Артист - Трек» разбирается на пару', () => {
  assert.deepStrictEqual(splitArtistTitle('Кино - Группа крови'), { artist: 'Кино', title: 'Группа крови' });
});

test('splitArtistTitle: несколько дефисов — только первый разделитель', () => {
  assert.deepStrictEqual(splitArtistTitle('A - B - C'), { artist: 'A', title: 'B - C' });
});

test('splitArtistTitle: без дефиса — всё считается названием', () => {
  assert.deepStrictEqual(splitArtistTitle('Просто трек'), { artist: 'Неизвестный исполнитель', title: 'Просто трек' });
});

/* ---------- nameFromUrl ---------- */

test('nameFromUrl: имя файла из URL превращается в название', () => {
  const r = nameFromUrl('https://example.org/audio/Some_Artist_-_Cool+Track.mp3?token=x');
  assert.strictEqual(r.artist, 'Some Artist');
  assert.strictEqual(r.title, 'Cool Track');
});

test('nameFromUrl: мусорный URL не роняет код', () => {
  const r = nameFromUrl('не url');
  assert.ok(r.title);
});

/* ---------- парсеры списков ссылок ---------- */

test('parseM3U: #EXTINF-меты и относительные ссылки разрешаются от baseUrl', () => {
  const entries = parseM3U(
    '#EXTM3U\n#EXTINF:120,Кто-то - Что-то\n/songs/a.mp3\nhttps://cdn.example.org/b.mp3\n',
    'https://example.org/lists/x.m3u'
  );
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].url, 'https://example.org/songs/a.mp3');
  assert.strictEqual(entries[1].url, 'https://cdn.example.org/b.mp3');
  assert.strictEqual(entries[0].meta, 'Кто-то - Что-то');
});

test('parsePLS: File/Title-пары собираются по номерам', () => {
  const entries = parsePLS(
    '[playlist]\nFile1=https://a.org/1.mp3\nTitle1=Первый\nFile2=/rel.mp3\nNumberOfEntries=2\nVersion=2\n',
    'https://example.org/'
  );
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].url, 'https://a.org/1.mp3');
  assert.strictEqual(entries[1].url, 'https://example.org/rel.mp3');
});

test('parseXSPF: location с XML-сущностями декодируется', () => {
  const entries = parseXSPF(
    '<playlist><trackList><track><location>https://a.org/a&amp;b.mp3</location>' +
    '<title>T</title><creator>C</creator></track></trackList></playlist>',
    'https://example.org/'
  );
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].url, 'https://a.org/a&b.mp3');
  assert.strictEqual(entries[0].meta, 'C - T');
});

/* ---------- spotifyEmbedEntity ---------- */

function embedHtml(payload) {
  return '<html><head><script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify(payload) + '</script></head><body></body></html>';
}

test('spotifyEmbedEntity: вытаскивает entity с trackList и audioPreview', () => {
  const entity = spotifyEmbedEntity(embedHtml({
    props: { pageProps: { state: { data: { entity: {
      id: 'abc', name: 'Альбом', trackList: [
        { uri: 'spotify:track:t1', title: 'Трек', subtitle: 'Артист', duration: 30000,
          audioPreview: { url: 'https://p.scdn.co/mp3-preview/x' } }
      ]
    } } } } }
  }));
  assert.strictEqual(entity.trackList.length, 1);
  assert.strictEqual(entity.trackList[0].audioPreview.url, 'https://p.scdn.co/mp3-preview/x');
});

test('spotifyEmbedEntity: региональный блок даёт понятную ошибку', () => {
  assert.throws(
    () => spotifyEmbedEntity(embedHtml({ props: { pageProps: { status: 404 } } })),
    /Spotify недоступен в вашем регионе/
  );
});

test('spotifyEmbedEntity: битый JSON даёт ошибку разбора', () => {
  assert.throws(
    () => spotifyEmbedEntity('<script id="__NEXT_DATA__">{битый json</script>'),
    /Не удалось разобрать ответ Spotify/
  );
});

test('spotifyEmbedEntity: без __NEXT_DATA__ — страница не та', () => {
  assert.throws(() => spotifyEmbedEntity('<html></html>'), /не вернул данные публичной страницы/);
});

/* ---------- yandexImage ---------- */

test('yandexImage: протокол-относительная ссылка и плейсхолдер размера', () => {
  assert.strictEqual(
    yandexImage('//avatars.mds.yandex.net/x/%%'),
    'https://avatars.mds.yandex.net/x/400x400'
  );
  assert.strictEqual(yandexImage(null), null);
});
