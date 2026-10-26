// Encrypted, opt-in token storage for the desktop app.
// Tokens are encrypted with the OS keychain through Electron safeStorage and
// are never returned to the renderer (only the list of saved services is).
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const SERVICES = ['vk', 'yandex', 'spotify'];

function tokensFile() {
  return path.join(app.getPath('userData'), 'tokens.json');
}

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch (err) {
    return false;
  }
}

function readStore() {
  try {
    const raw = fs.readFileSync(tokensFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Не удалось прочитать токены:', err.message);
    return {};
  }
}

async function writeStore(store) {
  const target = tokensFile();
  const temp = target + '.tmp';
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(temp, JSON.stringify(store), 'utf8');
  await fs.promises.rename(temp, target);
}

function loadTokens() {
  if (!encryptionAvailable()) return {};
  const store = readStore();
  const out = {};
  SERVICES.forEach(function (service) {
    const encoded = store[service];
    if (!encoded) return;
    try {
      out[service] = safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    } catch (err) {
      console.error('Не удалось расшифровать токен ' + service + ':', err.message);
    }
  });
  return out;
}

async function saveToken(service, token) {
  if (SERVICES.indexOf(service) === -1) throw new Error('Неизвестный сервис: ' + service);
  if (!token) return removeToken(service);
  if (!encryptionAvailable()) {
    throw new Error('Системное шифрование недоступно — токен нельзя сохранить безопасно.');
  }
  const store = readStore();
  store[service] = safeStorage.encryptString(String(token)).toString('base64');
  await writeStore(store);
  return true;
}

async function removeToken(service) {
  const store = readStore();
  if (!store[service]) return false;
  delete store[service];
  await writeStore(store);
  return true;
}

function savedServices() {
  if (!encryptionAvailable()) return [];
  const store = readStore();
  return SERVICES.filter(function (service) {
    return !!store[service];
  });
}

module.exports = {
  SERVICES: SERVICES,
  encryptionAvailable: encryptionAvailable,
  loadTokens: loadTokens,
  saveToken: saveToken,
  removeToken: removeToken,
  savedServices: savedServices
};
