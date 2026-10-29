// Official OAuth helpers for Sonor (desktop main process).
// Tokens never leave this process: the renderer only receives account metadata.
const { app, BrowserWindow, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL, URLSearchParams } = require('url');
const tokenStore = require('./tokenStore');
const { checkToken } = require('./importers');

const DEFAULTS = {
  vkClientId: '',
  yandexClientId: '',
  yandexScope: '',
  spotifyClientId: '',
  spotifyRedirectUri: 'http://127.0.0.1:53682/callback'
};
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{2,160}$/;
const YANDEX_DEVICE_CODE_URL = 'https://oauth.yandex.ru/device/code';
const YANDEX_TOKEN_URL = 'https://oauth.yandex.ru/token';
const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const VK_AUTHORIZE_URL = 'https://oauth.vk.com/authorize';
const SPOTIFY_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-read-private'
].join(' ');

const yandexFlows = new Map();

function configFile() {
  return path.join(app.getPath('userData'), 'oauth.json');
}

function cleanClientId(value) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, 160);
}

function validateClientId(value, label) {
  const id = cleanClientId(value);
  if (!id) return '';
  if (!CLIENT_ID_RE.test(id)) {
    throw new Error(label + ': Client ID содержит недопустимые символы');
  }
  return id;
}

function normalizeRedirect(value) {
  const raw = String(value || DEFAULTS.spotifyRedirectUri).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (err) {
    throw new Error('Redirect URI должен быть корректным http-адресом');
  }
  if (parsed.protocol !== 'http:') {
    throw new Error('Redirect URI для Spotify должен начинаться с http://');
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('Redirect URI должен указывать на 127.0.0.1 или localhost');
  }
  const port = Number(parsed.port);
  if (!port || port < 1024 || port > 65535) {
    throw new Error('Redirect URI должен содержать свободный порт от 1024 до 65535');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Redirect URI не должен содержать логин, query или fragment');
  }
  return parsed.toString();
}

function loadConfig() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configFile(), 'utf8')) || {};
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Не удалось прочитать oauth.json:', err.message);
  }
  let redirect = DEFAULTS.spotifyRedirectUri;
  try {
    redirect = normalizeRedirect(stored.spotifyRedirectUri || redirect);
  } catch (err) {
    console.error('Некорректный Redirect URI в oauth.json:', err.message);
  }
  return {
    vkClientId: cleanClientId(stored.vkClientId),
    yandexClientId: cleanClientId(stored.yandexClientId),
    yandexScope: cleanClientId(stored.yandexScope),
    spotifyClientId: cleanClientId(stored.spotifyClientId),
    spotifyRedirectUri: redirect
  };
}

function publicConfig() {
  const config = loadConfig();
  return {
    vkClientId: config.vkClientId,
    yandexClientId: config.yandexClientId,
    yandexScope: config.yandexScope,
    spotifyClientId: config.spotifyClientId,
    spotifyRedirectUri: config.spotifyRedirectUri
  };
}

async function saveConfig(payload) {
  const current = loadConfig();
  const next = {
    vkClientId: payload && payload.vkClientId !== undefined
      ? validateClientId(payload.vkClientId, 'VK')
      : current.vkClientId,
    yandexClientId: payload && payload.yandexClientId !== undefined
      ? validateClientId(payload.yandexClientId, 'Яндекс')
      : current.yandexClientId,
    yandexScope: payload && payload.yandexScope !== undefined
      ? cleanClientId(payload.yandexScope).slice(0, 120)
      : current.yandexScope,
    spotifyClientId: payload && payload.spotifyClientId !== undefined
      ? validateClientId(payload.spotifyClientId, 'Spotify')
      : current.spotifyClientId,
    spotifyRedirectUri: payload && payload.spotifyRedirectUri !== undefined
      ? normalizeRedirect(payload.spotifyRedirectUri)
      : current.spotifyRedirectUri
  };
  const target = configFile();
  const temp = target + '.tmp';
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
  await fs.promises.rename(temp, target);
  return publicConfig();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function request(targetUrl, options) {
  return new Promise(function (resolve, reject) {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      reject(new Error('Некорректный адрес OAuth'));
      return;
    }
    if (parsed.protocol !== 'https:') {
      reject(new Error('OAuth разрешён только по HTTPS'));
      return;
    }
    const opts = options || {};
    const headers = Object.assign({
      'User-Agent': 'Sonor/1.5 (Electron; +https://github.com/MyNameIsNikki/Sonor)',
      Accept: 'application/json, text/plain, */*'
    }, opts.headers || {});
    const body = opts.body || null;
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request({
      protocol: 'https:',
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: headers
    }, function (res) {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        text += chunk;
        if (text.length > 2 * 1024 * 1024) {
          req.destroy(new Error('Слишком большой ответ OAuth'));
        }
      });
      res.on('end', function () {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          text: text,
          json: parseJson(text)
        });
      });
    });
    req.setTimeout(25000, function () {
      req.destroy(new Error('Превышено время ожидания OAuth'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function postForm(targetUrl, form) {
  const body = form.toString();
  return request(targetUrl, {
    method: 'POST',
    body: body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
}

function oauthError(response, fallback) {
  const json = response && response.json;
  if (json && (json.error_description || json.error)) {
    return String(json.error_description || json.error);
  }
  const text = response && response.text ? response.text.replace(/\s+/g, ' ').slice(0, 180) : '';
  return fallback + (text ? ' (' + text + ')' : '');
}

function expiresAtFrom(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Date.now() + value * 1000;
}

async function accountFor(service, accessToken) {
  try {
    return await checkToken(service, accessToken);
  } catch (err) {
    return null;
  }
}

async function persist(service, data) {
  const record = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken || null,
    expiresAt: data.expiresAt || null,
    clientId: data.clientId || null,
    redirectUri: data.redirectUri || null,
    method: data.method || 'oauth',
    account: data.account || null,
    savedAt: new Date().toISOString()
  };
  await tokenStore.saveAuthRecord(service, record);
  return record;
}

function getAuthStatus() {
  const records = tokenStore.loadAuthRecords();
  const config = loadConfig();
  const services = {};
  ['vk', 'yandex', 'spotify'].forEach(function (service) {
    const record = records[service];
    services[service] = record ? {
      saved: true,
      method: record.method || 'manual',
      account: record.account || null,
      expiresAt: record.expiresAt || null,
      hasRefreshToken: !!record.refreshToken,
      clientIdConfigured: !!(service === 'vk'
        ? config.vkClientId
        : service === 'yandex'
          ? config.yandexClientId
          : config.spotifyClientId)
    } : {
      saved: false,
      method: null,
      account: null,
      expiresAt: null,
      hasRefreshToken: false,
      clientIdConfigured: !!(service === 'vk'
        ? config.vkClientId
        : service === 'yandex'
          ? config.yandexClientId
          : config.spotifyClientId)
    };
  });
  return {
    services: services,
    config: {
      vkConfigured: !!config.vkClientId,
      yandexConfigured: !!config.yandexClientId,
      spotifyConfigured: !!config.spotifyClientId,
      spotifyRedirectUri: config.spotifyRedirectUri,
      encryptionAvailable: tokenStore.encryptionAvailable()
    }
  };
}

function requireEncryption() {
  if (!tokenStore.encryptionAvailable()) {
    throw new Error('Системное шифрование недоступно — безопасный вход невозможен.');
  }
}

async function startYandexDevice() {
  requireEncryption();
  const config = loadConfig();
  if (!config.yandexClientId) {
    throw new Error('Сначала укажите Client ID приложения Яндекс ID в настройках OAuth.');
  }
  const form = new URLSearchParams();
  form.set('client_id', config.yandexClientId);
  form.set('device_name', 'Sonor desktop');
  if (config.yandexScope) form.set('scope', config.yandexScope);
  const response = await postForm(YANDEX_DEVICE_CODE_URL, form);
  if (response.status < 200 || response.status >= 300 || !response.json || !response.json.device_code) {
    throw new Error(oauthError(response, 'Яндекс не выдал код устройства'));
  }
  const json = response.json;
  const flowId = crypto.randomBytes(18).toString('hex');
  const interval = Math.max(2, Number(json.interval) || 5);
  const expiresIn = Math.max(30, Number(json.expires_in) || 300);
  yandexFlows.set(flowId, {
    deviceCode: String(json.device_code),
    clientId: config.yandexClientId,
    interval: interval,
    expiresAt: Date.now() + expiresIn * 1000
  });
  return {
    flowId: flowId,
    userCode: String(json.user_code || ''),
    verificationUrl: String(json.verification_url || json.verification_uri || 'https://oauth.yandex.ru/device'),
    interval: interval,
    expiresIn: expiresIn
  };
}

async function pollYandexDevice(flowId) {
  const flow = yandexFlows.get(String(flowId || ''));
  if (!flow) throw new Error('Сессия входа Яндекс ID не найдена. Начните вход заново.');
  if (Date.now() > flow.expiresAt) {
    yandexFlows.delete(String(flowId));
    return { status: 'error', error: 'Код Яндекс ID истёк. Начните вход заново.' };
  }
  const form = new URLSearchParams();
  form.set('grant_type', 'device_code');
  form.set('code', flow.deviceCode);
  form.set('client_id', flow.clientId);
  const response = await postForm(YANDEX_TOKEN_URL, form);
  const json = response.json || {};
  if (json.access_token) {
    const accessToken = String(json.access_token);
    const account = await accountFor('yandex', accessToken);
    await persist('yandex', {
      accessToken: accessToken,
      refreshToken: json.refresh_token ? String(json.refresh_token) : null,
      expiresAt: expiresAtFrom(json.expires_in),
      clientId: flow.clientId,
      method: 'oauth-device',
      account: account
    });
    yandexFlows.delete(String(flowId));
    return { status: 'ok', account: account };
  }
  const error = String(json.error || '');
  if (error === 'authorization_pending') {
    return { status: 'pending', interval: flow.interval };
  }
  if (error === 'slow_down') {
    flow.interval = Math.min(flow.interval + 5, 60);
    return { status: 'pending', interval: flow.interval, slowDown: true };
  }
  yandexFlows.delete(String(flowId));
  return {
    status: 'error',
    error: json.error_description || (error === 'access_denied'
      ? 'Доступ к аккаунту отклонён.'
      : oauthError(response, 'Яндекс не подтвердил вход'))
  };
}

function vkAuthorizeUrl(clientId) {
  const url = new URL(VK_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    display: 'page',
    redirect_uri: 'https://oauth.vk.com/blank.html',
    scope: 'audio',
    response_type: 'token',
    v: '5.131',
    revoke: '1'
  }).toString();
  return url.toString();
}

function tokenFromVkUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (err) {
    return null;
  }
  if (parsed.hostname !== 'oauth.vk.com' && parsed.hostname !== 'vk.com') return null;
  if (parsed.pathname.indexOf('/blank.html') === -1) return null;
  const hash = parsed.hash ? new URLSearchParams(parsed.hash.slice(1)) : new URLSearchParams();
  const query = parsed.searchParams;
  const token = hash.get('access_token') || query.get('access_token');
  if (!token) return null;
  return {
    accessToken: token,
    expiresIn: hash.get('expires_in') || query.get('expires_in'),
    userId: hash.get('user_id') || query.get('user_id')
  };
}

function loginVk(parent) {
  return new Promise(function (resolve, reject) {
    const config = loadConfig();
    if (!config.vkClientId) {
      reject(new Error('Сначала укажите Client ID приложения VK в настройках OAuth.'));
      return;
    }
    let settled = false;
    let timer = null;
    const authWindow = new BrowserWindow({
      width: 520,
      height: 760,
      parent: parent || undefined,
      show: false,
      modal: false,
      autoHideMenuBar: true,
      title: 'VK — безопасный вход',
      backgroundColor: '#060d12',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: 'sonor-vk-oauth-' + Date.now()
      }
    });
    authWindow.setMenuBarVisibility(false);
    authWindow.webContents.setWindowOpenHandler(function () {
      return { action: 'deny' };
    });

    function finish(error, token) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (!authWindow.isDestroyed()) authWindow.close();
      if (error) {
        reject(error);
        return;
      }
      Promise.resolve()
        .then(function () {
          return accountFor('vk', token.accessToken);
        })
        .then(function (account) {
          return persist('vk', {
            accessToken: token.accessToken,
            expiresAt: expiresAtFrom(token.expiresIn),
            clientId: config.vkClientId,
            method: 'oauth',
            account: account
          });
        })
        .then(function (record) {
          resolve({ ok: true, account: record.account, expiresAt: record.expiresAt });
        })
        .catch(reject);
    }

    function inspect(raw) {
      const token = tokenFromVkUrl(raw);
      if (token) finish(null, token);
    }

    authWindow.webContents.on('will-redirect', function (event, raw) {
      if (tokenFromVkUrl(raw)) {
        event.preventDefault();
        inspect(raw);
      }
    });
    authWindow.webContents.on('will-navigate', function (event, raw) {
      if (tokenFromVkUrl(raw)) {
        event.preventDefault();
        inspect(raw);
      }
    });
    authWindow.webContents.on('did-navigate-in-page', function (event, raw) {
      inspect(raw);
    });
    authWindow.webContents.on('did-navigate', function (event, raw) {
      inspect(raw);
    });
    authWindow.on('closed', function () {
      if (!settled) finish(new Error('Вход через VK отменён.'));
    });
    authWindow.once('ready-to-show', function () {
      if (!authWindow.isDestroyed()) authWindow.show();
    });
    authWindow.loadURL(vkAuthorizeUrl(config.vkClientId)).catch(function (err) {
      finish(new Error('Не удалось открыть страницу VK: ' + err.message));
    });
    timer = setTimeout(function () {
      finish(new Error('Время ожидания входа VK истекло.'));
    }, 5 * 60 * 1000);
  });
}

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pkcePair() {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier: verifier, challenge: challenge };
}

function spotifyAuthorizeUrl(config, state, challenge) {
  const url = new URL(SPOTIFY_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.spotifyClientId,
    response_type: 'code',
    redirect_uri: config.spotifyRedirectUri,
    scope: SPOTIFY_SCOPES,
    state: state,
    code_challenge_method: 'S256',
    code_challenge: challenge
  }).toString();
  return url.toString();
}

function spotifyServer(redirectUri, state) {
  return new Promise(function (resolve, reject) {
    let parsed;
    try {
      parsed = new URL(redirectUri);
    } catch (err) {
      reject(new Error('Некорректный Redirect URI Spotify'));
      return;
    }
    let settled = false;
    let started = false;
    let timer = null;
    let waitResolve;
    const wait = new Promise(function (res) { waitResolve = res; });

    function finish(error, code) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      server.close();
      waitResolve(error ? { error: error.message || String(error) } : { code: code });
    }

    const server = http.createServer(function (req, res) {
      let requestUrl;
      try {
        requestUrl = new URL(req.url, redirectUri);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad request');
        return;
      }
      if (requestUrl.pathname !== parsed.pathname) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const error = requestUrl.searchParams.get('error');
      const code = requestUrl.searchParams.get('code');
      const returnedState = requestUrl.searchParams.get('state');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><body style="background:#060d12;color:#e7f3f8;font:16px sans-serif;padding:40px">Вход Spotify отменён. Можно закрыть вкладку.</body></html>');
        finish(new Error('Вход Spotify отклонён.'));
        return;
      }
      if (!code || returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><body style="background:#060d12;color:#e7f3f8;font:16px sans-serif;padding:40px">Некорректный ответ Spotify. Вернитесь в Sonor.</body></html>');
        finish(new Error('Некорректный ответ Spotify (state).'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><body style="background:#060d12;color:#e7f3f8;font:16px sans-serif;padding:40px"><h2 style="color:#22d3ee">Spotify подключён</h2><p>Можно закрыть эту вкладку и вернуться в Sonor.</p></body></html>');
      finish(null, code);
    });

    server.on('error', function (err) {
      if (settled) return;
      if (!started) {
        settled = true;
        reject(new Error('Не удалось запустить локальный callback ' + parsed.host + ': ' + err.message));
        return;
      }
      finish(err);
    });
    server.listen(Number(parsed.port), parsed.hostname, function () {
      started = true;
      timer = setTimeout(function () {
        finish(new Error('Время ожидания входа Spotify истекло.'));
      }, 5 * 60 * 1000);
      resolve({
        wait: wait,
        close: function () {
          finish(new Error('Вход Spotify отменён.'));
        }
      });
    });
  });
}

async function loginSpotify(parent) {
  requireEncryption();
  const config = loadConfig();
  if (!config.spotifyClientId) {
    throw new Error('Сначала укажите Client ID приложения Spotify в настройках OAuth.');
  }
  const state = base64Url(crypto.randomBytes(24));
  const pair = pkcePair();
  const callback = await spotifyServer(config.spotifyRedirectUri, state);
  try {
    await shell.openExternal(spotifyAuthorizeUrl(config, state, pair.challenge));
    const callbackResult = await callback.wait;
    if (callbackResult.error) throw new Error(callbackResult.error);
    const code = callbackResult.code;
    const form = new URLSearchParams();
    form.set('grant_type', 'authorization_code');
    form.set('code', code);
    form.set('redirect_uri', config.spotifyRedirectUri);
    form.set('client_id', config.spotifyClientId);
    form.set('code_verifier', pair.verifier);
    const response = await postForm(SPOTIFY_TOKEN_URL, form);
    if (response.status < 200 || response.status >= 300 || !response.json || !response.json.access_token) {
      throw new Error(oauthError(response, 'Spotify не выдал токен'));
    }
    const json = response.json;
    const accessToken = String(json.access_token);
    const account = await accountFor('spotify', accessToken);
    const record = await persist('spotify', {
      accessToken: accessToken,
      refreshToken: json.refresh_token ? String(json.refresh_token) : null,
      expiresAt: expiresAtFrom(json.expires_in),
      clientId: config.spotifyClientId,
      redirectUri: config.spotifyRedirectUri,
      method: 'oauth-pkce',
      account: account
    });
    return { ok: true, account: record.account, expiresAt: record.expiresAt };
  } finally {
    callback.close();
  }
}

async function refreshAccessToken(service, record) {
  const config = loadConfig();
  const clientId = record.clientId || (service === 'spotify' ? config.spotifyClientId : config.yandexClientId);
  if (!clientId) throw new Error('Не найден Client ID для обновления сессии. Войдите заново.');
  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', record.refreshToken);
  form.set('client_id', clientId);
  const target = service === 'spotify' ? SPOTIFY_TOKEN_URL : YANDEX_TOKEN_URL;
  const response = await postForm(target, form);
  if (response.status < 200 || response.status >= 300 || !response.json || !response.json.access_token) {
    throw new Error(oauthError(response, 'Сессия истекла. Войдите заново.'));
  }
  const json = response.json;
  const updated = await persist(service, {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : record.refreshToken,
    expiresAt: expiresAtFrom(json.expires_in),
    clientId: clientId,
    redirectUri: record.redirectUri || null,
    method: record.method || 'oauth',
    account: record.account || null
  });
  return updated.accessToken;
}

async function getValidToken(service) {
  const record = tokenStore.loadAuthRecords()[service];
  if (!record || !record.accessToken) return null;
  const expiresSoon = record.expiresAt && record.expiresAt - Date.now() < 60 * 1000;
  if (!expiresSoon) return record.accessToken;
  if (!record.refreshToken || service === 'vk') return record.accessToken;
  return refreshAccessToken(service, record);
}

async function login(service, parent) {
  if (service === 'vk') return loginVk(parent);
  if (service === 'spotify') return loginSpotify(parent);
  throw new Error('Для Яндекса используется вход по коду устройства.');
}

async function logout(service) {
  if (tokenStore.SERVICES.indexOf(service) === -1) throw new Error('Неизвестный сервис');
  await tokenStore.removeToken(service);
  return { ok: true };
}

module.exports = {
  loadConfig: loadConfig,
  publicConfig: publicConfig,
  saveConfig: saveConfig,
  getAuthStatus: getAuthStatus,
  getValidToken: getValidToken,
  startYandexDevice: startYandexDevice,
  pollYandexDevice: pollYandexDevice,
  login: login,
  logout: logout
};
