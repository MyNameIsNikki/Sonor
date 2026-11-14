// Рендер assets/icon.svg в PNG через Chromium (Electron offscreen).
// Запуск: node_modules/electron/dist/electron.exe scripts/render-icon.js [выход.png]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// В VM/без GPU аппаратный рендер падает — кадры берём из программного конвейера
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    const svgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
    const outPath = process.argv[2] || path.join(__dirname, '..', 'build', 'icon-1024.png');
    const svg = fs.readFileSync(svgPath, 'utf8');
    const html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
      '*{margin:0;padding:0}html,body{width:1024px;height:1024px;overflow:hidden;background:transparent}' +
      '</style></head><body>' +
      svg.replace('<svg ', '<svg width="1024" height="1024" ') +
      '</body></html>';

    const win = new BrowserWindow({
      show: false,
      width: 1024,
      height: 1024,
      useContentSize: true,
      frame: false,
      webPreferences: { offscreen: true }
    });

    let saved = false;
    win.webContents.beginFrameSubscription(function (image, callback) {
      callback();
      if (saved || image.getWidth() !== 1024) return;
      const png = image.toPNG();
      if (!png.length) return;
      saved = true;
      fs.writeFileSync(outPath, png);
      console.log('ICON RENDERED:', outPath, png.length, 'bytes');
      setTimeout(() => app.exit(0), 100);
    });

    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    // Страховка: если кадры не пришли, пинаем перерисовку и ждём
    for (let i = 0; i < 20 && !saved; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (!saved) win.webContents.invalidate();
    }
    if (!saved) throw new Error('кадры offscreen-рендера не поступили');
  } catch (err) {
    console.error('RENDER FAILED:', err.message);
    app.exit(1);
  }
});
