// Безопасный вход в Яндекс Музыку через официальный Device Flow.
// Пароль вводится только на сайте Яндекса, приложение получает лишь токен.
import * as SecureStore from 'expo-secure-store';

const CLIENT_KEY = 'sonor_yandex_oauth_client';
const TOKEN_KEY = 'sonor_token_yandex';
const DEVICE_CODE_URL = 'https://oauth.yandex.ru/device/code';
const TOKEN_URL = 'https://oauth.yandex.ru/token';

export const YANDEX_DEVICE_URL = 'https://oauth.yandex.ru/device';
export const YANDEX_APPS_URL = 'https://oauth.yandex.ru/';

function encodeForm(values) {
  return Object.keys(values)
    .filter((key) => values[key] !== undefined && values[key] !== null)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(values[key]))}`)
    .join('&');
}

async function postForm(url, values) {
  let timer = null;
  let controller = null;

  try {
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 25000);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: encodeForm(values),
      signal: controller ? controller.signal : undefined
    });

    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (error) {
      data = null;
    }

    if (!response.ok && (!data || !data.error)) {
      throw new Error(`Сервис авторизации вернул ошибку ${response.status}`);
    }
    return data || {};
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Яндекс не ответил. Проверьте подключение к интернету.');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorText(data) {
  const raw = String(
    (data && (data.error_description || data.error)) || 'Не удалось войти через Яндекс'
  );
  if (/client not found|invalid_client/i.test(raw)) {
    return 'Яндекс не нашёл приложение. Проверьте Client ID и включённый Device Flow.';
  }
  if (/invalid_grant|expired|code/i.test(raw) && /expired|invalid_grant/i.test(raw)) {
    return 'Код входа истёк. Получите новый код.';
  }
  if (/access_denied/i.test(raw)) return 'Доступ отклонён на сайте Яндекса.';
  return raw;
}

export function validateYandexClientId(value) {
  const clientId = String(value || '').trim();
  if (!/^[A-Za-z0-9._-]{2,160}$/.test(clientId)) {
    throw new Error('Client ID должен содержать только латинские буквы, цифры, точку, дефис или подчёркивание.');
  }
  return clientId;
}

export async function loadYandexClientId() {
  try {
    return (await SecureStore.getItemAsync(CLIENT_KEY)) || '';
  } catch (error) {
    return '';
  }
}

export async function saveYandexClientId(value) {
  const clientId = validateYandexClientId(value);
  await SecureStore.setItemAsync(CLIENT_KEY, clientId);
  return clientId;
}

export async function loadYandexToken() {
  try {
    return (await SecureStore.getItemAsync(TOKEN_KEY)) || '';
  } catch (error) {
    return '';
  }
}

export async function saveYandexToken(token) {
  const value = String(token || '').trim();
  if (!value) throw new Error('Пустой токен Яндекс Музыки');
  await SecureStore.setItemAsync(TOKEN_KEY, value);
  return true;
}

export async function clearYandexToken() {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch (error) {
    // Токен мог не сохраниться — это не ошибка выхода.
  }
}

export async function startYandexDeviceFlow(value) {
  const clientId = validateYandexClientId(value);
  const data = await postForm(DEVICE_CODE_URL, {
    client_id: clientId,
    device_name: 'Sonor Mobile'
  });

  if (!data.device_code || !data.user_code) {
    throw new Error(errorText(data));
  }

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_url || YANDEX_DEVICE_URL,
    interval: Math.max(3, Number(data.interval) || 5),
    expiresIn: Math.max(30, Number(data.expires_in) || 300)
  };
}

export async function pollYandexDeviceFlow(value, deviceCode) {
  const clientId = validateYandexClientId(value);
  const data = await postForm(TOKEN_URL, {
    grant_type: 'device_code',
    code: deviceCode,
    client_id: clientId
  });

  if (data.access_token) {
    return {
      status: 'ok',
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expiresIn: Number(data.expires_in) || 0
    };
  }

  if (data.error === 'authorization_pending') {
    return { status: 'pending' };
  }
  if (data.error === 'slow_down') {
    return {
      status: 'pending',
      interval: Math.max(5, Number(data.interval) || 10),
      slowDown: true
    };
  }
  if (data.error === 'access_denied') {
    return { status: 'error', error: 'Доступ отклонён на сайте Яндекса.' };
  }
  if (data.error === 'expired_token' || data.error === 'invalid_grant') {
    return { status: 'error', error: 'Код входа истёк. Получите новый код.' };
  }

  return { status: 'error', error: errorText(data) };
}
