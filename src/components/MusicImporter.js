// Music Importer Component with full-library integration
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
import { importVKMusic, importYandexMusic, importSpotify } from '../services/musicImport';

const SERVICES = {
  vk: { name: 'VK Music', colors: ['#4facfe', '#00f2fe'] },
  yandex: { name: 'Яндекс Музыка', colors: ['#00b4d8', '#0077b6'] },
  spotify: { name: 'Spotify', colors: ['#1db954', '#1ed760'] }
};

const MusicImporter = ({ onImportComplete }) => {
  const [importingService, setImportingService] = useState(null);
  const [showTokenInputs, setShowTokenInputs] = useState(false);
  const [progress, setProgress] = useState('');
  const [tokens, setTokens] = useState({
    vk: '',
    yandex: '',
    spotify: ''
  });

  const handleImport = async (service) => {
    const serviceInfo = SERVICES[service];
    const token = tokens[service].trim();

    if (!token) {
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
      onImportComplete(result, service, token);
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

  return (
    <BlurView intensity={30} tint="light" style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Импорт всей музыки</Text>
        <TouchableOpacity onPress={() => setShowTokenInputs(!showTokenInputs)}>
          <Text style={styles.tokenToggle}>{showTokenInputs ? 'Скрыть' : 'Токены'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.description}>
        Загрузим всю медиатеку: треки, плейлисты, любимое и альбомы.
      </Text>

      {showTokenInputs && (
        <View style={styles.tokenInputs}>
          <TextInput
            style={styles.tokenInput}
            placeholder="VK Token"
            placeholderTextColor="#6f95a6"
            value={tokens.vk}
            onChangeText={(value) => setTokens({ ...tokens, vk: value })}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <TextInput
            style={styles.tokenInput}
            placeholder="Yandex Token"
            placeholderTextColor="#6f95a6"
            value={tokens.yandex}
            onChangeText={(value) => setTokens({ ...tokens, yandex: value })}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <TextInput
            style={styles.tokenInput}
            placeholder="Spotify Token"
            placeholderTextColor="#6f95a6"
            value={tokens.spotify}
            onChangeText={(value) => setTokens({ ...tokens, spotify: value })}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Text style={styles.tokenHint}>
            Токены хранятся только в памяти приложения и не сохраняются на устройстве.
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
              disabled={!!importingService}
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
                  <Text style={styles.serviceHint}>Вся медиатека</Text>
                </LinearGradient>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.footnote}>
        Spotify отдаёт 30-секундные превью, а ссылки VK и Яндекс Музыки со временем
        истекают — при необходимости просто импортируйте заново.
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
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#00d4ff'
  },
  tokenToggle: {
    color: '#a0c4d8',
    fontSize: 13,
    textDecorationLine: 'underline'
  },
  description: {
    fontSize: 12,
    color: '#8fb2c2',
    lineHeight: 18,
    marginBottom: 14
  },
  tokenInputs: {
    gap: 10,
    marginBottom: 15
  },
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
  tokenHint: {
    fontSize: 10.5,
    color: '#6f95a6',
    lineHeight: 15
  },
  servicesContainer: {
    gap: 10
  },
  serviceBtn: {
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 5
  },
  importing: {
    opacity: 0.85
  },
  gradient: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 12
  },
  serviceText: {
    color: '#041e27',
    fontSize: 15.5,
    fontWeight: '800'
  },
  serviceHint: {
    color: 'rgba(4, 30, 39, 0.72)',
    fontSize: 10.5,
    fontWeight: '600',
    marginTop: 1
  },
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
  loadingText: {
    flex: 1,
    color: '#bfe6f5',
    fontSize: 12,
    lineHeight: 17
  },
  footnote: {
    fontSize: 10.5,
    color: '#6f95a6',
    lineHeight: 16,
    marginTop: 13
  }
});

export default MusicImporter;
