// Отладочный вход Electron для мобильной вёрстки (npm run web -> localhost:19006).
// Продакш-приложение собирается через electron-main.js + index.html.
const { app, BrowserWindow, Menu, screen } = require('electron');
const url = require('url');

app.setName('Sonor');

// Один экземпляр приложения: повторный запуск открывает существующее окно.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow;

function installMenu() {
  // Меню скрыто, но даёт рабочие Ctrl+C / Ctrl+V в полях ввода.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Перезагрузить' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' }
      ]
    }
  ]));
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1280, Math.max(800, workArea.width - 48)),
    height: Math.min(800, Math.max(600, workArea.height - 48)),
    minWidth: 800,
    minHeight: 600,
    center: true,
    backgroundColor: '#0f2027',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    },
    frame: false,
    titleBarStyle: 'hidden',
    title: 'Sonor Music Player'
  });

  installMenu();

  // Load the React Native/Electron bridge
  mainWindow.loadURL(url.format({
    protocol: 'http',
    host: 'localhost:19006',
    pathname: '/',
    slashes: true
  }));

  // Development tools
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
