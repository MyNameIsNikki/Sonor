// Собирает все размеры иконки из build/icon-1024.png:
//   build/icon.ico (16..256 для Windows), icon.png (1024, Expo),
//   build/icon.png (256). Запуск: node scripts/build-icon-ico.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const Jimp = require('jimp');
const pngToIco = require('png-to-ico').default;

const root = path.join(__dirname, '..');
const source = path.join(root, 'build', 'icon-1024.png');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

(async () => {
  const base = await Jimp.read(source);
  if (base.bitmap.width !== 1024) throw new Error('ожидался PNG 1024x1024');

  // png-to-ico принимает пути к PNG — каждый размер пишем во временный файл
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonor-ico-'));
  const files = [];
  for (const size of SIZES) {
    const resized = base.clone().resize(size, size, Jimp.RESIZE_BICUBIC);
    const file = path.join(tempDir, size + '.png');
    await resized.writeAsync(file);
    files.push(file);
    if (size === 256) {
      fs.writeFileSync(path.join(root, 'build', 'icon.png'), await resized.getBufferAsync(Jimp.MIME_PNG));
    }
  }

  const ico = await pngToIco(files);
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);
  fs.writeFileSync(path.join(root, 'icon.png'), await base.getBufferAsync(Jimp.MIME_PNG));
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log('ICO built:', SIZES.join('/'), '+ icon.png 1024 + build/icon.png 256');
})().catch((err) => {
  console.error('ICO FAILED:', err.message);
  process.exit(1);
});
