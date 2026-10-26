// Music Importer: full-library token import, remembered tokens and public links.
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  TextInput
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  importVKMusic,
  importYandexMusic,
  importSpotify,
  importPublicLink
} from '../services/musicImport';

const SERVICES = {
  vk: { name: 'VK Music', colors: ['#4facfe', '#00f2fe'] },
  yandex: { name: 'Яндекс Музыка', colors: ['#00b4d8', '#0077b6'] },
  spotify: { name: 'Spotify', colors: ['#1db954', '#1ed760'] }
};

const MusicImporter = ({
  onImportComplete,
  onLinkComplete,
  savedServices = [],
  encryptionAvailable = true,
  getToken = () => ''
}) => {
  const [importingService, setImportingService] = useState(null);
  const [showTokenInputs, setShowTokenInputs] = useState(false);
  const [progress, setProgress] = useState('');
  const [remember, setRemember] = useState(true);
  const [linkUrl, setLinkUrl] = useState('');
  const [importingLink, setImportingLink] = useState(false);
  const [tokens, setTokens] = useState({
    vk: '',
    yandex: '',
    spotify: ''
  });

  const handleImport = async (service) => {
    const serviceInfo = SERVICES[service];
    const token = tokens[service].trim() || getToken(service) || '';
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
      onImportComplete(result, service, token, remember);
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

  return (
    <BlurView intensity={30} tint="light" style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Импорт всей музыки</Text>
        <TouchableOpacity onPress={() => setShowTokenInputs(!showTokenInputs)}>
          <Text style={styles.tokenToggle}>{showTokenInputs ? 'Скрыть' : 'Токены'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.description}>
        Вся медиатека: треки, плейлисты, любимое и альбомы. Или добавьте публичную ссылку без токена.
      </Text>

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

      <Text style={styles.footnote}>
        Spotify отдаёт 30-секундные превью и может быть недоступен в вашем регионе.
        Ссылки VK и Яндекс Музыки со временем истекают — повторный импорт обновит их.
      </Text>
    </BlurView>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 4,
    marginBottom: 18,
    padding: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(15, 32, 39, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.3)',
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
  footnote: { fontSize: 10.5, color: '#6f95a6', lineHeight: 16, marginTop: 13 }
});

export default MusicImporter;
