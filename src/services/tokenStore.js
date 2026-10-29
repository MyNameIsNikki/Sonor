// Encrypted, opt-in token storage for the desktop app.
// Tokens are encrypted with the OS keychain through Electron safeStorage and
// are never returned to the renderer (only account metadata is).
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

function normalizeRecord(record) {
  const out = Object.assign({}, record);
  out.accessToken = String(record.accessToken || '');
  out.method = record.method || 'manual';
  if (record.expiresAt !== undefined && record.expiresAt !== null) {
    const value = Number(record.expiresAt);
    if (Number.isFinite(value)) out.expiresAt = value;
    else delete out.expiresAt;
  }
  if (!out.savedAt) out.savedAt = new Date().toISOString();
  return out;
}

function decodeValue(encoded) {
  const raw = safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.accessToken) {
      return normalizeRecord(parsed);
    }
  } catch (err) {
    // Старый формат: зашифрованная строка с самим токеном.
  }
  return normalizeRecord({ accessToken: raw, method: 'manual' });
}

function loadAuthRecords() {
  if (!encryptionAvailable()) return {};
  const store = readStore();
  const out = {};
  SERVICES.forEach(function (service) {
    const encoded = store[service];
    if (!encoded) return;
    try {
      out[service] = decodeValue(encoded);
    } catch (err) {
      console.error('Не удалось расшифровать токен ' + service + ':', err.message);
    }
  });
  return out;
}

function loadTokens() {
  const records = loadAuthRecords();
  const out = {};
  SERVICES.forEach(function (service) {
    if (records[service] && records[service].accessToken) {
      out[service] = records[service].accessToken;
    }
  });
  return out;
}

async function saveAuthRecord(service, record) {
  if (SERVICES.indexOf(service) === -1) throw new Error('Неизвестный сервис: ' + service);
  if (!record || !record.accessToken) throw new Error('Токен не указан');
  if (!encryptionAvailable()) {
    throw new Error('Системное шифрование недоступно — токен нельзя сохранить безопасно.');
  }
  const normalized = normalizeRecord(record);
  const store = readStore();
  store[service] = safeStorage
    .encryptString(JSON.stringify(normalized))
    .toString('base64');
  await writeStore(store);
  return true;
}

async function saveToken(service, token) {
  if (!token) return removeToken(service);
  return saveAuthRecord(service, {
    accessToken: String(token),
    method: 'manual',
    savedAt: new Date().toISOString()
  });
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

function getAuthInfo(service) {
  const records = loadAuthRecords();
  const record = records[service];
  if (!record) return { saved: false };
  return {
    saved: true,
    method: record.method || 'manual',
    account: record.account || null,
    expiresAt: record.expiresAt || null,
    hasRefreshToken: !!record.refreshToken,
    clientId: record.clientId || null,
    redirectUri: record.redirectUri || null,
    savedAt: record.savedAt || null
  };
}

module.exports = {
  SERVICES: SERVICES,
  encryptionAvailable: encryptionAvailable,
  loadAuthRecords: loadAuthRecords,
  loadTokens: loadTokens,
  saveAuthRecord: saveAuthRecord,
  saveToken: saveToken,
  removeToken: removeToken,
  savedServices: savedServices,
  getAuthInfo: getAuthInfo
};
