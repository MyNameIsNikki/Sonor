const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const url = require('url');

let mainWindow;

function createWindow() {
 mainWindow = new BrowserWindow({
 width: 1280,
 height: 800,
 minWidth: 800,
 minHeight: 600,
 backgroundColor: '#0f2027',
 webPreferences: {
 nodeIntegration: true,
 contextIsolation: false,
 webSecurity: false
 },
 frame: false,
 titleBarStyle: 'hidden',
 title: 'Sonor Music Player'
 });

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

app.on('window-all-closed', () => {
 if (process.platform !== 'darwin') {
 app.quit();
 }
});