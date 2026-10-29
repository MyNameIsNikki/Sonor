// Music Importer: full-library token import, remembered tokens and public links.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  TextInput,
  Linking,
  Modal
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  importVKMusic,
  importYandexMusic,
  importSpotify,
  importPublicLink
} from '../services/musicImport';
import { pickPlaylistFiles } from '../services/playlistImportMobile';
import {
  YANDEX_APPS_URL,
  YANDEX_DEVICE_URL,
  clearYandexToken,
  loadYandexClientId,
  pollYandexDeviceFlow,
  saveYandexClientId,
  saveYandexToken,
  startYandexDeviceFlow,
  validateYandexClientId
} from '../services/yandexOAuthMobile';

const SERVICES = {
  vk: { name: 'VK Music', colors: ['#4facfe', '#00f2fe'] },
  yandex: { name: 'Яндекс Музыка', colors: ['#00b4d8', '#0077b6'] },
  spotify: { name: 'Spotify', colors: ['#1db954', '#1ed760'] }
};

const MusicImporter = ({
  onImportComplete,
  onLinkComplete,
  onPlaylistComplete,
  savedServices = [],
  encryptionAvailable = true,
  getToken = () => '',
  onYandexToken,
  onForgetToken
}) => {
  const [importingService, setImportingService] = useState(null);
  const [showTokenInputs, setShowTokenInputs] = useState(false);
  const [progress, setProgress] = useState('');
  const [remember, setRemember] = useState(true);
  const [linkUrl, setLinkUrl] = useState('');
  const [importingLink, setImportingLink] = useState(false);
  const [importingPlaylist, setImportingPlaylist] = useState(false);
  const [tokens, setTokens] = useState({
    vk: '',
    yandex: '',
    spotify: ''
  });
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthSettingsOpen, setOauthSettingsOpen] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthConnected, setOauthConnected] = useState(false);
  const [oauthModalOpen, setOauthModalOpen] = useState(false);
  const [oauthCode, setOauthCode] = useState('');
  const [oauthUrl, setOauthUrl] = useState(YANDEX_DEVICE_URL);
  const [oauthStatus, setOauthStatus] = useState('');
  const oauthTimerRef = useRef(null);
  const oauthFlowRef = useRef(null);
  const oauthCancelledRef = useRef(false);

  useEffect(() => {
    let alive = true;
    loadYandexClientId()
      .then((value) => {
        if (alive && value) setOauthClientId(value);
      })
      .catch(() => {});
    if (savedServices.indexOf('yandex') !== -1) setOauthConnected(true);
    return () => {
      alive = false;
      oauthCancelledRef.current = true;
      if (oauthTimerRef.current) clearTimeout(oauthTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (savedServices.indexOf('yandex') !== -1) setOauthConnected(true);
  }, [savedServices]);

  const handleImport = async (service, overrideToken, forceRemember) => {
    const serviceInfo = SERVICES[service];
    const token = String(overrideToken || '').trim() || tokens[service].trim() || getToken(service) || '';
    const saved = savedServices.indexOf(service) !== -1;

    if (!token && !saved) {
      Alert.alert(
        `Введите токен ${serviceInfo.name}`,
        'Пожалуйста, введите токен доступа для импорта'
      );
      setShowTokenInputs(true);
      return;
    }

    setImportingService(service);
    setProgress('Подключаемся к сервису…');

    try {
      const runners = {
        vk: importVKMusic,
        yandex: importYandexMusic,
        spotify: importSpotify
      };
      const result = await runners[service](token, (update) => {
        if (update && update.message) setProgress(update.message);
      });
      if (!result || !result.tracks || !result.tracks.length) {
        throw new Error('Сервис не вернул ни одного трека');
      }
      setTokens((current) => ({ ...current, [service]: '' }));
      onImportComplete(result, service, token, forceRemember === undefined ? remember : forceRemember);
    } catch (error) {
      Alert.alert(
        'Ошибка импорта',
        `Не удалось импортировать из ${serviceInfo.name}.\n\n${error.message || 'Проверьте токен и подключение к интернету.'}`
      );
    } finally {
      setImportingService(null);
      setProgress('');
    }
  };

  const handleLinkImport = async () => {
    const value = linkUrl.trim();
    if (!value) {
      Alert.alert('Вставьте ссылку', 'Поддерживаются Spotify, Яндекс Музыка, M3U/PLS/XSPF и аудиоссылки.');
      return;
    }
    setImportingLink(true);
    setProgress('Читаем ссылку…');
    try {
      const result = await importPublicLink(value, (update) => {
        if (update && update.message) setProgress(update.message);
      });
      if (!result || !result.tracks || !result.tracks.length) {
        throw new Error('По ссылке не найдено ни одного трека');
      }
      setLinkUrl('');
      onLinkComplete(result);
    } catch (error) {
      Alert.alert('Ошибка импорта по ссылке', error.message || 'Проверьте ссылку и подключение к интернету.');
    } finally {
      setImportingLink(false);
      setProgress('');
    }
  };

  const handlePlaylistImport = async () => {
    if (importingPlaylist) return;
    setImportingPlaylist(true);
    setProgress('Читаем файл плейлиста…');
    try {
      const result = await pickPlaylistFiles();
      if (result) {
        onPlaylistComplete(result);
      }
    } catch (error) {
      Alert.alert('Не удалось перенести плейлист', error.message || 'Проверьте формат файла.');
    } finally {
      setImportingPlaylist(false);
      setProgress('');
    }
  };

  const saveOAuthClientId = async () => {
    try {
      const clientId = validateYandexClientId(oauthClientId);
      await saveYandexClientId(clientId);
      setOauthClientId(clientId);
      setOauthSettingsOpen(false);
      setOauthStatus('✓ Client ID сохранён');
    } catch (error) {
      setOauthStatus(`✕ ${error.message || 'Не удалось сохранить Client ID'}`);
    }
  };

  const openYandexUrl = async (url) => {
    try {
      await Linking.openURL(url || YANDEX_DEVICE_URL);
    } catch (error) {
      Alert.alert('Не удалось открыть браузер', 'Откройте oauth.yandex.ru/device вручную.');
    }
  };

  const stopOAuthFlow = () => {
    oauthCancelledRef.current = true;
    if (oauthTimerRef.current) {
      clearTimeout(oauthTimerRef.current);
      oauthTimerRef.current = null;
    }
    oauthFlowRef.current = null;
    setOauthBusy(false);
    setOauthModalOpen(false);
  };

  const waitForYandex = (clientId, flow) => {
    const expiresAt = Date.now() + flow.expiresIn * 1000;
    oauthCancelledRef.current = false;

    const poll = async () => {
      if (oauthCancelledRef.current) return;
      if (Date.now() > expiresAt) {
        stopOAuthFlow();
        setOauthStatus('✕ Код входа истёк. Получите новый код.');
        return;
      }

      try {
        const result = await pollYandexDeviceFlow(clientId, flow.deviceCode);
        if (oauthCancelledRef.current) return;

        if (result.status === 'ok') {
          oauthCancelledRef.current = true;
          if (oauthTimerRef.current) clearTimeout(oauthTimerRef.current);
          oauthTimerRef.current = null;
          oauthFlowRef.current = null;
          setOauthModalOpen(false);
          setOauthConnected(true);
          setOauthBusy(false);

          let tokenSaved = true;
          try {
            if (typeof onYandexToken === 'function') {
              tokenSaved = await onYandexToken(result.accessToken);
            } else {
              await saveYandexToken(result.accessToken);
            }
          } catch (error) {
            tokenSaved = false;
          }

          setOauthStatus(
            tokenSaved
              ? '✓ Яндекс подключён. Импортируем медиатеку…'
              : '✓ Вход выполнен, но токен не сохранён в защищённом хранилище.'
          );

          await handleImport('yandex', result.accessToken, true);
          return;
        }

        if (result.status === 'error') {
          stopOAuthFlow();
          setOauthStatus(`✕ ${result.error || 'Не удалось войти через Яндекс'}`);
          return;
        }

        if (result.interval) flow.interval = result.interval;
        setOauthStatus(
          result.slowDown
            ? 'Яндекс просит подождать. Проверяем снова через несколько секунд…'
            : 'Ожидаем подтверждения на сайте Яндекса…'
        );
        oauthTimerRef.current = setTimeout(
          poll,
          Math.max(3, Number(flow.interval) || 5) * 1000
        );
      } catch (error) {
        if (oauthCancelledRef.current) return;
        stopOAuthFlow();
        setOauthStatus(`✕ ${error.message || 'Не удалось проверить вход'}`);
      }
    };

    oauthTimerRef.current = setTimeout(
      poll,
      Math.max(3, Number(flow.interval) || 5) * 1000
    );
  };

  const handleYandexOAuth = async () => {
    if (oauthBusy) return;
    const clientId = String(oauthClientId || '').trim();
    if (!clientId) {
      setOauthSettingsOpen(true);
      Alert.alert(
        'Нужен Client ID',
        'Создайте приложение на oauth.yandex.ru и вставьте его Client ID. Пароль вводить в приложение не нужно.'
      );
      return;
    }

    let normalized;
    try {
      normalized = validateYandexClientId(clientId);
    } catch (error) {
      setOauthSettingsOpen(true);
      setOauthStatus(`✕ ${error.message || 'Проверьте Client ID'}`);
      return;
    }

    try {
      await saveYandexClientId(normalized);
    } catch (error) {
      setOauthStatus('Client ID не сохранён, но вход можно продолжить.');
    }

    setOauthBusy(true);
    setOauthStatus('Запрашиваем код у Яндекса…');

    try {
      const flow = await startYandexDeviceFlow(normalized);
      oauthFlowRef.current = flow;
      setOauthCode(flow.userCode);
      setOauthUrl(flow.verificationUrl || YANDEX_DEVICE_URL);
      setOauthModalOpen(true);
      setOauthStatus('Введите код на сайте Яндекса и подтвердите доступ.');
      waitForYandex(normalized, flow);
      openYandexUrl(flow.verificationUrl || YANDEX_DEVICE_URL);
    } catch (error) {
      setOauthBusy(false);
      setOauthStatus(`✕ ${error.message || 'Не удалось начать вход через Яндекс'}`);
    }
  };

  const handleCancelYandex = () => {
    stopOAuthFlow();
    setOauthStatus('Вход отменён');
    setOauthCode('');
  };

  const handleForgetYandex = async () => {
    stopOAuthFlow();
    try {
      if (typeof onForgetToken === 'function') {
        await onForgetToken('yandex');
      } else {
        await clearYandexToken();
      }
      setOauthConnected(false);
      setTokens((current) => ({ ...current, yandex: '' }));
      setOauthStatus('Токен Яндекс Музыки удалён с устройства.');
    } catch (error) {
      setOauthStatus(`✕ ${error.message || 'Не удалось удалить токен'}`);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Импорт всей музыки</Text>
        <TouchableOpacity onPress={() => setShowTokenInputs(!showTokenInputs)}>
          <Text style={styles.tokenToggle}>{showTokenInputs ? 'Скрыть' : 'Токены'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.description}>
        Вся медиатека: треки, плейлисты, любимое и альбомы. Или добавьте публичную ссылку без токена.
      </Text>

      <View style={styles.oauthCard}>
        <View style={styles.oauthHead}>
          <View style={styles.oauthIcon}>
            <Text style={styles.oauthIconText}>Я</Text>
          </View>
          <View style={styles.oauthHeadText}>
            <Text style={styles.oauthTitle}>Безопасный вход через Яндекс</Text>
            <Text style={styles.oauthSubtitle}>Пароль вводится только на сайте Яндекса</Text>
          </View>
          <TouchableOpacity
            onPress={() => setOauthSettingsOpen(!oauthSettingsOpen)}
            activeOpacity={0.8}
          >
            <Text style={styles.oauthToggle}>
              {oauthSettingsOpen ? 'Скрыть' : 'Настроить'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.oauthDescription}>
          Приложение получает только токен доступа и хранит его в защищённом хранилище.
          Вводить пароль Яндекса в Sonor не нужно.
        </Text>

        {oauthSettingsOpen && (
          <View style={styles.oauthSettings}>
            <TextInput
              style={styles.oauthInput}
              placeholder="Client ID приложения Яндекса"
              placeholderTextColor="#6f95a6"
              value={oauthClientId}
              onChangeText={setOauthClientId}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={saveOAuthClientId}
            />
            <View style={styles.oauthSettingsActions}>
              <TouchableOpacity
                style={styles.oauthSaveBtn}
                onPress={saveOAuthClientId}
                activeOpacity={0.82}
              >
                <Text style={styles.oauthSaveText}>Сохранить Client ID</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openYandexUrl(YANDEX_APPS_URL)}
                activeOpacity={0.8}
              >
                <Text style={styles.oauthDocsLink}>Где взять Client ID</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.oauthSettingsHint}>
              Создайте приложение на oauth.yandex.ru и включите Device Flow.
              Client ID не является секретом.
            </Text>
          </View>
        )}

        <View style={styles.oauthActions}>
          <TouchableOpacity
            style={[styles.oauthLoginBtn, (oauthBusy || !!importingService) && styles.importing]}
            onPress={handleYandexOAuth}
            disabled={oauthBusy || !!importingService}
            activeOpacity={0.82}
          >
            {oauthBusy ? (
              <View style={styles.oauthLoading}>
                <ActivityIndicator color="#04161c" size="small" />
                <Text style={styles.oauthLoginText}>Ожидаем Яндекс…</Text>
              </View>
            ) : (
              <Text style={styles.oauthLoginText}>
                {oauthConnected ? 'Переподключить Яндекс' : 'Войти через Яндекс'}
              </Text>
            )}
          </TouchableOpacity>

          {oauthConnected && (
            <TouchableOpacity
              style={styles.oauthForgetBtn}
              onPress={handleForgetYandex}
              disabled={oauthBusy}
              activeOpacity={0.8}
            >
              <Text style={styles.oauthForgetText}>Отключить</Text>
            </TouchableOpacity>
          )}
        </View>

        {oauthStatus ? (
          <Text
            style={[
              styles.oauthStatus,
              oauthStatus.indexOf('✓') === 0 && styles.oauthStatusOk,
              oauthStatus.indexOf('✕') === 0 && styles.oauthStatusErr
            ]}
          >
            {oauthStatus}
          </Text>
        ) : null}

        <Text style={styles.oauthHint}>
          VK и Spotify на телефоне подключаются через токен ниже. OAuth не обходит
          ограничения сервисов: доступ к медиатеке зависит от прав вашего приложения.
        </Text>
      </View>

      {showTokenInputs && (
        <View style={styles.tokenInputs}>
          {Object.keys(SERVICES).map((service) => {
            const saved = savedServices.indexOf(service) !== -1;
            return (
              <TextInput
                key={service}
                style={styles.tokenInput}
                placeholder={saved ? `${SERVICES[service].name}: токен сохранён` : `${SERVICES[service].name} Token`}
                placeholderTextColor="#6f95a6"
                value={tokens[service]}
                onChangeText={(value) => setTokens({ ...tokens, [service]: value })}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
            );
          })}

          <TouchableOpacity
            style={styles.rememberRow}
            onPress={() => setRemember(!remember)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, remember && styles.checkboxOn]}>
              {remember && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.rememberText}>
              Запоминать токены и обновлять библиотеку при запуске
            </Text>
          </TouchableOpacity>

          <Text style={styles.tokenHint}>
            {encryptionAvailable
              ? 'Токены шифруются и хранятся только на этом устройстве. Их можно удалить, выключив галочку и импортировав заново.'
              : 'Безопасное хранилище недоступно — токены будут действовать только до закрытия приложения.'}
          </Text>
        </View>
      )}

      <View style={styles.servicesContainer}>
        {Object.keys(SERVICES).map((service) => {
          const info = SERVICES[service];
          const isImporting = importingService === service;
          return (
            <TouchableOpacity
              key={service}
              style={[styles.serviceBtn, importingService && styles.importing]}
              onPress={() => handleImport(service)}
              disabled={!!importingService || importingLink}
              activeOpacity={0.82}
            >
              {isImporting ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator color="#00d4ff" size="small" />
                  <Text style={styles.loadingText}>{progress || 'Импортируем…'}</Text>
                </View>
              ) : (
                <LinearGradient colors={info.colors} style={styles.gradient}>
                  <Text style={styles.serviceText}>{info.name}</Text>
                  <Text style={styles.serviceHint}>
                    {savedServices.indexOf(service) !== -1 ? 'Токен сохранён · вся медиатека' : 'Вся медиатека'}
                  </Text>
                </LinearGradient>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.divider} />

      <Text style={styles.linkTitle}>Без токена — по ссылке</Text>
      <Text style={styles.linkHint}>
        Плейлист или альбом Spotify / Яндекс Музыки, M3U, PLS, XSPF или прямая аудиоссылка.
      </Text>
      <View style={styles.linkRow}>
        <TextInput
          style={styles.linkInput}
          placeholder="https://open.spotify.com/playlist/…"
          placeholderTextColor="#6f95a6"
          value={linkUrl}
          onChangeText={setLinkUrl}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.linkBtn, (importingLink || importingService) && styles.importing]}
          onPress={handleLinkImport}
          disabled={importingLink || !!importingService}
          activeOpacity={0.82}
        >
          {importingLink ? (
            <ActivityIndicator color="#041e27" size="small" />
          ) : (
            <Text style={styles.linkBtnText}>Добавить</Text>
          )}
        </TouchableOpacity>
      </View>
      {importingLink && <Text style={styles.linkProgress}>{progress || 'Импортируем…'}</Text>}

      <View style={styles.divider} />

      <Text style={styles.linkTitle}>Перенос плейлиста из VK / Яндекса</Text>
      <Text style={styles.linkHint}>
        M3U, M3U8, PLS, XSPF, CSV или JSON с прямыми аудиоссылками. Можно выбрать сразу несколько файлов.
      </Text>
      <TouchableOpacity
        style={[styles.playlistButton, importingPlaylist && styles.importing]}
        onPress={handlePlaylistImport}
        disabled={importingPlaylist || importingLink || !!importingService}
        activeOpacity={0.82}
      >
        {importingPlaylist ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#04161c" size="small" />
            <Text style={styles.playlistButtonText}>{progress || 'Читаем плейлист…'}</Text>
          </View>
        ) : (
          <Text style={styles.playlistButtonText}>📁 Выбрать файлы плейлистов</Text>
        )}
      </TouchableOpacity>
      <Text style={styles.playlistHint}>
        Нужны прямые ссылки на аудио. Ссылки на страницы VK, Яндекса или Spotify пропускаются — это не обход авторизации сервисов.
      </Text>

      <Text style={styles.footnote}>
        Spotify отдаёт 30-секундные превью и может быть недоступен в вашем регионе.
        Ссылки VK и Яндекс Музыки со временем истекают — повторный импорт обновит их.
      </Text>

      <Modal
        visible={oauthModalOpen}
        transparent
        animationType="fade"
        onRequestClose={handleCancelYandex}
      >
        <View style={styles.oauthModalBackdrop}>
          <View style={styles.oauthModalCard}>
            <Text style={styles.oauthModalTitle}>Вход через Яндекс</Text>
            <Text style={styles.oauthModalText}>
              Откройте сайт Яндекса и введите этот код. Пароль остаётся на сайте сервиса.
            </Text>
            <Text selectable style={styles.oauthCode}>{oauthCode}</Text>
            <TouchableOpacity
              style={styles.oauthModalPrimary}
              onPress={() => openYandexUrl(oauthUrl)}
              activeOpacity={0.82}
            >
              <Text style={styles.oauthModalPrimaryText}>Открыть сайт Яндекса</Text>
            </TouchableOpacity>
            <Text selectable style={styles.oauthModalUrl}>{oauthUrl}</Text>
            <Text
              style={[
                styles.oauthModalStatus,
                oauthStatus.indexOf('✓') === 0 && styles.oauthStatusOk,
                oauthStatus.indexOf('✕') === 0 && styles.oauthStatusErr
              ]}
            >
              {oauthStatus || 'Ожидаем подтверждения…'}
            </Text>
            <TouchableOpacity
              style={styles.oauthModalCancel}
              onPress={handleCancelYandex}
              activeOpacity={0.8}
            >
              <Text style={styles.oauthModalCancelText}>Отмена</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 4,
    marginBottom: 18,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#0a151b',
    borderWidth: 1,
    borderColor: '#172832',
    overflow: 'hidden'
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  title: { fontSize: 18, fontWeight: 'bold', color: '#00d4ff' },
  tokenToggle: { color: '#a0c4d8', fontSize: 13, textDecorationLine: 'underline' },
  description: { fontSize: 12, color: '#8fb2c2', lineHeight: 18, marginBottom: 14 },
  oauthCard: {
    marginBottom: 14,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.28)',
    backgroundColor: 'rgba(34, 211, 238, 0.06)'
  },
  oauthHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  oauthIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 204, 0, 0.14)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  oauthIconText: { color: '#ffd43b', fontSize: 15, fontWeight: '900' },
  oauthHeadText: { flex: 1 },
  oauthTitle: { color: '#e7f3f8', fontSize: 13, fontWeight: '800' },
  oauthSubtitle: { color: '#8fb2c2', fontSize: 10, marginTop: 2 },
  oauthToggle: { color: '#22d3ee', fontSize: 10.5, fontWeight: '700' },
  oauthDescription: { color: '#8fb2c2', fontSize: 10.5, lineHeight: 15, marginTop: 9 },
  oauthSettings: { marginTop: 10, gap: 8 },
  oauthInput: {
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
    color: '#fff',
    fontSize: 12,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.2)'
  },
  oauthSettingsActions: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  oauthSaveBtn: {
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 8,
    backgroundColor: 'rgba(34, 211, 238, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.34)'
  },
  oauthSaveText: { color: '#22d3ee', fontSize: 10.5, fontWeight: '800' },
  oauthDocsLink: { color: '#8fb2c2', fontSize: 10.5, textDecorationLine: 'underline' },
  oauthSettingsHint: { color: '#6f95a6', fontSize: 9.5, lineHeight: 14 },
  oauthActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 11 },
  oauthLoginBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: '#22d3ee',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  oauthLoading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  oauthLoginText: { color: '#04161c', fontSize: 12, fontWeight: '900' },
  oauthForgetBtn: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.34)'
  },
  oauthForgetText: { color: '#ff8b8b', fontSize: 10.5, fontWeight: '700' },
  oauthStatus: { color: '#9bb6c2', fontSize: 10, lineHeight: 14, marginTop: 8 },
  oauthStatusOk: { color: '#5ee6a8' },
  oauthStatusErr: { color: '#ff8b8b' },
  oauthHint: { color: '#6f95a6', fontSize: 9.5, lineHeight: 14, marginTop: 8 },
  oauthModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 12, 0.78)',
    justifyContent: 'center',
    padding: 22
  },
  oauthModalCard: {
    borderRadius: 16,
    padding: 18,
    backgroundColor: '#0a151b',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.3)'
  },
  oauthModalTitle: { color: '#e7f3f8', fontSize: 18, fontWeight: '900', marginBottom: 6 },
  oauthModalText: { color: '#8fb2c2', fontSize: 11, lineHeight: 16 },
  oauthCode: {
    color: '#22d3ee',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 6,
    textAlign: 'center',
    marginVertical: 16
  },
  oauthModalPrimary: {
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#22d3ee',
    alignItems: 'center'
  },
  oauthModalPrimaryText: { color: '#04161c', fontSize: 12, fontWeight: '900' },
  oauthModalUrl: { color: '#6f95a6', fontSize: 9.5, textAlign: 'center', marginTop: 8 },
  oauthModalStatus: { color: '#9bb6c2', fontSize: 10.5, lineHeight: 15, marginTop: 12 },
  oauthModalCancel: { alignSelf: 'center', padding: 10, marginTop: 2 },
  oauthModalCancelText: { color: '#ff8b8b', fontSize: 11, fontWeight: '700' },
  tokenInputs: { gap: 10, marginBottom: 15 },
  tokenInput: {
    backgroundColor: 'rgba(0, 0, 0, 0.24)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 13,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.14)'
  },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 2 },
  checkbox: {
    width: 19,
    height: 19,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.4)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkboxOn: { backgroundColor: '#00d4ff', borderColor: '#00d4ff' },
  checkmark: { color: '#041e27', fontSize: 13, fontWeight: '900', lineHeight: 16 },
  rememberText: { flex: 1, color: '#a0c4d8', fontSize: 11, lineHeight: 15 },
  tokenHint: { fontSize: 10.5, color: '#6f95a6', lineHeight: 15 },
  servicesContainer: { gap: 10 },
  serviceBtn: { borderRadius: 12, overflow: 'hidden', elevation: 5 },
  importing: { opacity: 0.85 },
  gradient: { paddingVertical: 13, paddingHorizontal: 16, borderRadius: 12 },
  serviceText: { color: '#041e27', fontSize: 15.5, fontWeight: '800' },
  serviceHint: { color: 'rgba(4, 30, 39, 0.72)', fontSize: 10.5, fontWeight: '600', marginTop: 1 },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 15,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0, 212, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.28)',
    borderRadius: 12
  },
  loadingText: { flex: 1, color: '#bfe6f5', fontSize: 12, lineHeight: 17 },
  divider: { height: 1, backgroundColor: 'rgba(0, 212, 255, 0.14)', marginVertical: 15 },
  linkTitle: { fontSize: 14.5, fontWeight: '700', color: '#d9f2fb', marginBottom: 4 },
  linkHint: { fontSize: 10.5, color: '#6f95a6', lineHeight: 15, marginBottom: 9 },
  linkRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  linkInput: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.24)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.14)'
  },
  linkBtn: {
    minWidth: 84,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: 10,
    backgroundColor: '#00d4ff',
    alignItems: 'center',
    justifyContent: 'center'
  },
  linkBtnText: { color: '#041e27', fontSize: 12, fontWeight: '800' },
  linkProgress: { fontSize: 10.5, color: '#8fb2c2', marginTop: 7 },
  playlistButton: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.42)'
  },
  playlistButtonText: { color: '#22d3ee', fontSize: 12.5, fontWeight: '800' },
  playlistHint: { fontSize: 10, color: '#6d8793', lineHeight: 15, marginTop: 8 },
  footnote: { fontSize: 10.5, color: '#6d8793', lineHeight: 16, marginTop: 13 }
});

export default MusicImporter;
