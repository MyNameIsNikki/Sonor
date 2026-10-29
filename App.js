// SONOR — мобильный музыкальный плеер с полным импортом медиатеки
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  SafeAreaView,
  StatusBar,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import MusicImporter from './src/components/MusicImporter';
import PlayerControls from './src/components/PlayerControls';
import TrackList from './src/components/TrackList';
import CollectionGrid from './src/components/CollectionGrid';
import FreeMusic from './src/components/FreeMusic';
import { importMusic, resolveYandexStream } from './src/services/musicImport';
import { resolveAudiusStream, downloadFreeTrack } from './src/services/freeMusicMobile';

const LIBRARY_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}sonor-library.json`
  : null;

const TOKEN_KEYS = {
  vk: 'sonor_token_vk',
  yandex: 'sonor_token_yandex',
  spotify: 'sonor_token_spotify'
};

const SERVICE_NAMES = {
  vk: 'VK Музыка',
  yandex: 'Яндекс Музыка',
  spotify: 'Spotify'
};

const SOURCE_LABELS = {
  local: 'ЛОКАЛЬНО',
  vk: 'VK',
  yandex: 'ЯНДЕКС',
  spotify: 'SPOTIFY',
  link: 'ССЫЛКА',
  audius: 'AUDIUS',
  ccmixter: 'CCMIXTER',
  archive: 'ARCHIVE'
};

const TABS = [
  { id: 'all', label: 'Все' },
  { id: 'playlists', label: 'Плейлисты' },
  { id: 'albums', label: 'Альбомы' },
  { id: 'free', label: 'Свободная' }
];

export default function App() {
  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [collections, setCollections] = useState([]);
  const [showImport, setShowImport] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeTab, setActiveTab] = useState('all');
  const [activeCollectionId, setActiveCollectionId] = useState(null);
  const [resolvingTrackId, setResolvingTrackId] = useState(null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(300);
  const [savedServices, setSavedServices] = useState([]);
  const [secureStoreAvailable, setSecureStoreAvailable] = useState(true);
  const [autoSyncStatus, setAutoSyncStatus] = useState('');

  const tokensRef = useRef({});
  const nextTrackRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [localTracks, saved] = await Promise.all([loadDeviceTracks(), loadSavedLibrary()]);
      if (!alive) return;
      const localIds = new Set(localTracks.map((track) => track.id));
      const imported = saved.tracks
        .filter((track) => track && track.id && !localIds.has(track.id))
        .map((track) => ({ ...track, src: track.path || track.url || null }));
      setTracks([...localTracks, ...imported]);
      setCollections(saved.collections);
      const remembered = await loadRememberedTokens();
      if (!alive) return;
      setLibraryReady(true);
      if (Object.keys(remembered).length) {
        syncRemembered(remembered, true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (sound) sound.unloadAsync().catch(() => {});
    };
  }, [sound]);

  useEffect(() => {
    if (!libraryReady || !LIBRARY_FILE) return undefined;
    const timer = setTimeout(() => {
      const imported = tracks
        .filter((track) => track.source !== 'local')
        .map((track) => ({
          id: track.id,
          externalId: track.externalId || null,
          title: track.title,
          artist: track.artist,
          album: track.album || '',
          duration: track.duration || 0,
          url: track.url || null,
          path: track.path || null,
          image: track.image || null,
          source: track.source,
          provider: track.provider || null,
          license: track.license || null,
          licenseUrl: track.licenseUrl || null,
          filePageUrl: track.filePageUrl || null,
          downloadable: !!track.downloadable,
          streamOnly: !!track.streamOnly,
          origin: track.origin || null,
          public: !!track.public
        }));
      const payload = JSON.stringify({
        version: 2,
        tracks: imported,
        collections,
        savedAt: new Date().toISOString()
      });
      FileSystem.writeAsStringAsync(LIBRARY_FILE, payload).catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [tracks, collections, libraryReady]);

  const visibleTracks = useMemo(() => {
    if (!activeCollectionId) return tracks;
    const collection = collections.find((item) => item.id === activeCollectionId);
    if (!collection) return tracks;
    const byId = new Map(tracks.map((track) => [track.id, track]));
    return collection.trackIds.map((id) => byId.get(id)).filter(Boolean);
  }, [tracks, collections, activeCollectionId]);

  const activeCollection = useMemo(
    () => collections.find((item) => item.id === activeCollectionId) || null,
    [collections, activeCollectionId]
  );

  const displayedTracks = useMemo(
    () => visibleTracks.slice(0, visibleLimit),
    [visibleTracks, visibleLimit]
  );

  const playlistCollections = useMemo(
    () =>
      collections.filter(
        (collection) =>
          collection.type === 'playlist' ||
          collection.type === 'liked' ||
          collection.type === 'library'
      ),
    [collections]
  );

  const albumCollections = useMemo(
    () => collections.filter((collection) => collection.type === 'album'),
    [collections]
  );

  const freeCount = useMemo(
    () => tracks.filter((track) => ['audius', 'ccmixter', 'archive'].includes(track.source)).length,
    [tracks]
  );

  const loadDeviceTracks = async () => {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) return [];
      const assets = [];
      let after;
      for (let page = 0; page < 10; page++) {
        const chunk = await MediaLibrary.getAssetsAsync({ mediaType: 'audio', first: 200, after });
        assets.push(...chunk.assets);
        if (!chunk.hasNextPage) break;
        after = chunk.endCursor;
      }
      const seen = new Set();
      return assets
        .filter((asset) => {
          if (!asset || !asset.id || seen.has(asset.id)) return false;
          seen.add(asset.id);
          return true;
        })
        .map((asset) => ({
          id: asset.id,
          title: asset.filename,
          artist: 'Локальный трек',
          album: '',
          duration: (asset.duration || 0) * 1000,
          uri: asset.uri,
          image: null,
          source: 'local'
        }));
    } catch (error) {
      console.log('Не удалось загрузить локальные треки:', error.message);
      return [];
    }
  };

  const loadSavedLibrary = async () => {
    if (!LIBRARY_FILE) return { tracks: [], collections: [] };
    try {
      const info = await FileSystem.getInfoAsync(LIBRARY_FILE);
      if (!info.exists) return { tracks: [], collections: [] };
      const raw = await FileSystem.readAsStringAsync(LIBRARY_FILE);
      const data = JSON.parse(raw);
      return {
        tracks: Array.isArray(data.tracks) ? data.tracks.filter((track) => track && track.id) : [],
        collections: Array.isArray(data.collections)
          ? data.collections.filter((collection) => collection && collection.id)
          : []
      };
    } catch (error) {
      console.log('Не удалось прочитать сохранённую медиатеку:', error.message);
      return { tracks: [], collections: [] };
    }
  };

  const loadRememberedTokens = async () => {
    let available = true;
    try {
      available = await SecureStore.isAvailableAsync();
    } catch (error) {
      available = false;
    }
    if (!available) {
      setSecureStoreAvailable(false);
      return {};
    }
    const remembered = {};
    for (const service of Object.keys(TOKEN_KEYS)) {
      try {
        const value = await SecureStore.getItemAsync(TOKEN_KEYS[service]);
        if (value) remembered[service] = value;
      } catch (error) {
        console.log('Не удалось прочитать токен:', service, error.message);
      }
    }
    setSavedServices(Object.keys(remembered));
    tokensRef.current = { ...tokensRef.current, ...remembered };
    return remembered;
  };

  const rememberToken = async (service, token, remember) => {
    if (!token) return false;
    if (!remember || !secureStoreAvailable) {
      try {
        await SecureStore.deleteItemAsync(TOKEN_KEYS[service]);
      } catch (error) {
        console.log('Не удалось удалить токен:', error.message);
      }
      setSavedServices((previous) => previous.filter((item) => item !== service));
      return false;
    }
    try {
      await SecureStore.setItemAsync(TOKEN_KEYS[service], token);
      setSavedServices((previous) =>
        previous.indexOf(service) === -1 ? [...previous, service] : previous
      );
      return true;
    } catch (error) {
      console.log('Не удалось сохранить токен:', error.message);
      setSecureStoreAvailable(false);
      return false;
    }
  };

  const mergeImportedResult = (service, result) => {
    const imported = (result.tracks || []).map((track) => ({
      ...track,
      duration: Math.round((track.duration || 0) * 1000),
      src: track.url || null
    }));
    setTracks((previous) => [
      ...previous.filter((track) => track.source !== service),
      ...imported
    ]);
    setCollections((previous) => [
      ...previous.filter((collection) => collection.source !== service),
      ...(result.collections || [])
    ]);
    return imported;
  };

  const syncRemembered = async (remembered, silent = false) => {
    const services = Object.keys(remembered);
    if (!services.length) return;
    setAutoSyncStatus('Обновляем сохранённую музыку…');
    let updated = 0;
    const errors = [];
    for (const service of services) {
      try {
        const result = await importMusic(service, remembered[service], (update) => {
          if (update && update.message) {
            setAutoSyncStatus(`${SERVICE_NAMES[service] || service}: ${update.message}`);
          }
        });
        if (result && result.tracks && result.tracks.length) {
          mergeImportedResult(service, result);
          updated += result.tracks.length;
        }
      } catch (error) {
        errors.push(`${SERVICE_NAMES[service] || service}: ${error.message}`);
      }
    }
    setAutoSyncStatus('');
    if (silent) {
      if (errors.length) console.log('Автосинхронизация:', errors.join('; '));
      return;
    }
    if (updated) {
      Alert.alert(
        'Библиотека обновлена',
        `Обновлено треков: ${updated}${errors.length ? `\n\n${errors.slice(0, 3).join('\n')}` : ''}`
      );
    } else {
      Alert.alert(
        'Не удалось обновить',
        errors.slice(0, 3).join('\n') || 'Проверьте токены и подключение к интернету.'
      );
    }
  };

  const getToken = (service) => tokensRef.current[service] || '';

  const syncSavedManually = () => {
    const remembered = {};
    savedServices.forEach((service) => {
      if (tokensRef.current[service]) remembered[service] = tokensRef.current[service];
    });
    if (!Object.keys(remembered).length) {
      Alert.alert(
        'Нет сохранённых токенов',
        'Импортируйте музыку с включённой галочкой «Запоминать токены».'
      );
      return;
    }
    syncRemembered(remembered, false);
  };

  const startPlayback = async (track, uri) => {
    if (!uri) {
      Alert.alert(
        'Нет ссылки',
        track.source === 'spotify' || (track.source === 'link' && track.provider === 'spotify')
          ? 'Spotify отдаёт только 30-секундные превью, и для этого трека оно недоступно.'
          : 'У этого трека нет прямой ссылки. Импортируйте медиатеку или добавьте ссылку заново — ссылки сервисов со временем истекают.'
      );
      return;
    }

    if (sound) await sound.unloadAsync().catch(() => {});
    const { sound: newSound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
    newSound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded) {
        setPosition(status.positionMillis || 0);
        setDuration(status.durationMillis || 0);
        setIsPlaying(!!status.isPlaying);
        if (status.didJustFinish && nextTrackRef.current) {
          nextTrackRef.current();
        }
      }
    });

    setSound(newSound);
    setIsPlaying(true);
    setCurrentTrack(track);
    setPosition(0);
    setDuration(track.duration || 0);
  };

  const handlePlayTrack = async (track) => {
    let playable = track;
    let uri = track.path || track.uri || track.url || track.src;

    const isYandex =
      track.source === 'yandex' || (track.source === 'link' && track.provider === 'yandex');
    if (!uri && isYandex) {
      const token = tokensRef.current.yandex || null;
      if (!token && !track.public) {
        Alert.alert(
          'Нужен токен Яндекса',
          'Ссылки Яндекс Музыки не сохраняются между запусками. Откройте «Импорт музыки», вставьте токен и импортируйте медиатеку заново.'
        );
        return;
      }
      setResolvingTrackId(track.id);
      try {
        const externalId =
          track.externalId ||
          String(track.id)
            .replace(/^link_/, '')
            .replace(/^yandex_/, '');
        let directUrl;
        try {
          directUrl = await resolveYandexStream(externalId, token);
        } catch (error) {
          if (!track.public) throw error;
          directUrl = await resolveYandexStream(externalId, null);
        }
        playable = { ...track, url: directUrl, src: directUrl };
        setTracks((previous) =>
          previous.map((item) => (item.id === track.id ? { ...item, url: directUrl, src: directUrl } : item))
        );
        uri = directUrl;
      } catch (error) {
        Alert.alert('Яндекс Музыка', `Не удалось получить ссылку на трек.\n\n${error.message}`);
        return;
      } finally {
        setResolvingTrackId(null);
      }
    }

    if (!uri && track.source === 'audius' && track.externalId) {
      setResolvingTrackId(track.id);
      try {
        const directUrl = await resolveAudiusStream(track.externalId);
        playable = { ...track, url: directUrl, src: directUrl };
        setTracks((previous) =>
          previous.map((item) => (item.id === track.id ? { ...item, url: directUrl, src: directUrl } : item))
        );
        uri = directUrl;
      } catch (error) {
        Alert.alert('Audius', `Не удалось получить поток.\n\n${error.message}`);
        return;
      } finally {
        setResolvingTrackId(null);
      }
    }

    try {
      await startPlayback(playable, uri);
    } catch (error) {
      console.error('Ошибка воспроизведения:', error);
      Alert.alert('Ошибка', 'Не удалось воспроизвести трек');
    }
  };

  const handleFreePlay = async (track) => {
    const existing = tracks.find((item) => item.id === track.id);
    const item = existing || {
      ...track,
      src: track.src || track.url || null,
      duration: Math.round(track.duration || 0)
    };
    if (!existing) {
      setTracks((previous) => [...previous, item]);
    }
    setActiveTab('free');
    await handlePlayTrack(item);
  };

  const handleFreeDownload = async (track) => {
    const result = await downloadFreeTrack(track);
    setTracks((previous) => {
      const exists = previous.some((item) => item.id === track.id);
      if (exists) {
        return previous.map((item) =>
          item.id === track.id
            ? { ...item, path: result.path, url: result.path, src: result.path }
            : item
        );
      }
      return [...previous, {
        ...track,
        path: result.path,
        url: result.path,
        src: result.path,
        duration: Math.round(track.duration || 0)
      }];
    });
    return result;
  };

  const playAdjacent = async (direction) => {
    const queue = visibleTracks.length ? visibleTracks : tracks;
    if (!queue.length) return;
    const index = currentTrack ? queue.findIndex((item) => item.id === currentTrack.id) : -1;
    let nextIndex;
    if (index === -1) {
      nextIndex = direction > 0 ? 0 : queue.length - 1;
    } else {
      nextIndex = (index + direction + queue.length) % queue.length;
    }
    await handlePlayTrack(queue[nextIndex]);
  };

  nextTrackRef.current = () => playAdjacent(1);

  const togglePlayback = async () => {
    if (!sound) return;
    if (isPlaying) {
      await sound.pauseAsync();
      setIsPlaying(false);
    } else {
      await sound.playAsync();
      setIsPlaying(true);
    }
  };

  const handleImportComplete = async (result, service, token, remember = true) => {
    const effectiveToken = (token || '').trim() || tokensRef.current[service] || '';
    if (effectiveToken) tokensRef.current[service] = effectiveToken;
    const imported = mergeImportedResult(service, result);

    setActiveCollectionId(null);
    setActiveTab('all');
    setVisibleLimit(300);
    setShowImport(false);
    scrollRef.current?.scrollTo({ y: 0, animated: true });

    const tokenSaved =
      effectiveToken && remember
        ? await rememberToken(service, effectiveToken, remember)
        : false;

    const stats = result.stats || {};
    let message = `Треков: ${stats.tracks || imported.length}`;
    if (stats.playlists) message += `\nПлейлистов: ${stats.playlists}`;
    if (stats.albums) message += `\nАльбомов: ${stats.albums}`;
    if (stats.liked) message += `\nЛюбимых треков: ${stats.liked}`;
    if (effectiveToken && remember && !tokenSaved) {
      message += '\n\nТокен не сохранён: безопасное хранилище недоступно.';
    }
    if (result.warnings && result.warnings.length) {
      message += `\n\n${result.warnings.slice(0, 3).join('\n')}`;
    }
    Alert.alert('Импорт завершён', message);
  };

  const handleLinkComplete = (result) => {
    const linkCollections = result.collections || [];
    const collectionIds = new Set(linkCollections.map((collection) => collection.id));
    const imported = (result.tracks || []).map((track) => ({
      ...track,
      duration: Math.round((track.duration || 0) * 1000),
      src: track.url || null
    }));

    setTracks((previous) => [
      ...previous.filter(
        (track) => !(track.source === 'link' && track.origin && collectionIds.has(track.origin))
      ),
      ...imported
    ]);
    setCollections((previous) => [
      ...previous.filter((collection) => !collectionIds.has(collection.id)),
      ...linkCollections
    ]);
    setActiveCollectionId(null);
    setActiveTab('all');
    setVisibleLimit(300);
    setShowImport(false);
    scrollRef.current?.scrollTo({ y: 0, animated: true });

    let message = `Добавлено треков: ${imported.length}`;
    if (linkCollections.length) message += `\nКоллекций: ${linkCollections.length}`;
    if (result.warnings && result.warnings.length) {
      message += `\n\n${result.warnings.slice(0, 3).join('\n')}`;
    }
    Alert.alert('Ссылка добавлена', message);
  };

  const handlePlaylistComplete = (result) => {
    const imported = result.tracks || [];
    const importedCollections = result.collections || [];
    const trackIds = new Set(imported.map((track) => track.id));
    const collectionIds = new Set(importedCollections.map((collection) => collection.id));

    setTracks((previous) => [
      ...previous.filter((track) => !trackIds.has(track.id)),
      ...imported
    ]);
    setCollections((previous) => [
      ...previous.filter((collection) => !collectionIds.has(collection.id)),
      ...importedCollections
    ]);
    setActiveCollectionId(null);
    setActiveTab('all');
    setVisibleLimit(300);
    setShowImport(false);
    scrollRef.current?.scrollTo({ y: 0, animated: true });

    let message = `Добавлено треков: ${imported.length}`;
    if (importedCollections.length) message += `\nПлейлистов: ${importedCollections.length}`;
    if (result.warnings && result.warnings.length) {
      message += `\n\n${result.warnings.slice(0, 3).join('\n')}`;
    }
    Alert.alert('Плейлист добавлен', message);
  };

  const openCollection = (collection) => {
    setActiveCollectionId(collection.id);
    setVisibleLimit(300);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const switchTab = (tab) => {
    setActiveTab(tab);
    setActiveCollectionId(null);
    setVisibleLimit(300);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const renderContent = () => {
    if (activeCollection) {
      return (
        <View>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setActiveCollectionId(null)}
            activeOpacity={0.75}
          >
            <Text style={styles.backText}>← Назад</Text>
          </TouchableOpacity>
          <Text style={styles.sectionTitle}>{activeCollection.title}</Text>
          <View style={styles.collectionMeta}>
            <Text style={styles.collectionSource}>
              {SOURCE_LABELS[activeCollection.source] || 'ИМПОРТ'}
            </Text>
            <Text style={styles.collectionCount}>
              {visibleTracks.length} {visibleTracks.length === 1 ? 'трек' : 'треков'}
            </Text>
          </View>
          <TrackList
            tracks={displayedTracks}
            onPlayTrack={handlePlayTrack}
            currentTrack={currentTrack}
          />
          {visibleTracks.length > displayedTracks.length && (
            <TouchableOpacity
              style={styles.moreButton}
              onPress={() => setVisibleLimit((value) => value + 300)}
              activeOpacity={0.75}
            >
              <Text style={styles.moreText}>
                Показать ещё 300 · всего {visibleTracks.length}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    if (activeTab === 'free') {
      return (
        <FreeMusic
          tracks={tracks}
          onPlayTrack={handleFreePlay}
          onDownloadTrack={handleFreeDownload}
        />
      );
    }

    if (activeTab === 'playlists') {
      return (
        <View>
          <Text style={styles.sectionTitle}>Плейлисты ({playlistCollections.length})</Text>
          <Text style={styles.sectionHint}>Плейлисты и любимые треки из сервисов</Text>
          <CollectionGrid
            collections={playlistCollections}
            kind="playlist"
            onOpen={openCollection}
          />
        </View>
      );
    }

    if (activeTab === 'albums') {
      return (
        <View>
          <Text style={styles.sectionTitle}>Альбомы ({albumCollections.length})</Text>
          <Text style={styles.sectionHint}>Сохранённые и любимые альбомы</Text>
          <CollectionGrid collections={albumCollections} kind="album" onOpen={openCollection} />
        </View>
      );
    }

    return (
      <View>
        <Text style={styles.sectionTitle}>Мои треки ({tracks.length})</Text>
        <TrackList
          tracks={displayedTracks}
          onPlayTrack={handlePlayTrack}
          currentTrack={currentTrack}
        />
        {visibleTracks.length > displayedTracks.length && (
          <TouchableOpacity
            style={styles.moreButton}
            onPress={() => setVisibleLimit((value) => value + 300)}
            activeOpacity={0.75}
          >
            <Text style={styles.moreText}>
              Показать ещё 300 · всего {visibleTracks.length}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <LinearGradient colors={['#060d12', '#07131a', '#081a22']} style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />

        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: currentTrack ? 200 : 40 }
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.appTitle}>🎧 SONOR</Text>
            <Text style={styles.subtitle}>VK • Яндекс • Spotify • Audius</Text>
            <Text style={styles.version}>MOBILE 1.4 · FREE MUSIC</Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Text style={styles.statValue}>{tracks.length}</Text>
              <Text style={styles.statLabel}>треков</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statValue}>{playlistCollections.length}</Text>
              <Text style={styles.statLabel}>плейлистов</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statValue}>{albumCollections.length}</Text>
              <Text style={styles.statLabel}>альбомов</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.importToggleBtn}
            onPress={() => setShowImport(!showImport)}
            activeOpacity={0.85}
          >
            <LinearGradient colors={['#22d3ee', '#06b6d4']} style={styles.importToggleGradient}>
              <Text style={styles.importToggleText}>
                {showImport ? 'Скрыть импорт' : '📥 Импорт и перенос музыки'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {autoSyncStatus ? (
            <View style={styles.syncStatus}>
              <ActivityIndicator color="#00d4ff" size="small" />
              <Text style={styles.syncHint}>{autoSyncStatus}</Text>
            </View>
          ) : savedServices.length > 0 ? (
            <TouchableOpacity
              style={styles.syncButton}
              onPress={syncSavedManually}
              activeOpacity={0.8}
            >
              <Text style={styles.syncButtonText}>
                ♻ Обновить сохранённую музыку ({savedServices.length})
              </Text>
            </TouchableOpacity>
          ) : null}

          {showImport && (
            <MusicImporter
              onImportComplete={handleImportComplete}
              onLinkComplete={handleLinkComplete}
              onPlaylistComplete={handlePlaylistComplete}
              savedServices={savedServices}
              encryptionAvailable={secureStoreAvailable}
              getToken={getToken}
            />
          )}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabsScroll}
            contentContainerStyle={styles.tabs}
          >
            {TABS.map((tab) => {
              const active = activeTab === tab.id && !activeCollectionId;
              const count =
                tab.id === 'playlists'
                  ? playlistCollections.length
                  : tab.id === 'albums'
                    ? albumCollections.length
                    : tab.id === 'free'
                      ? freeCount
                      : tracks.length;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => switchTab(tab.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                    {tab.label} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {resolvingTrackId ? (
            <Text style={styles.resolveHint}>Загружаем ссылку на трек…</Text>
          ) : null}

          {renderContent()}
        </ScrollView>

        {currentTrack && (
          <View style={styles.playerWrapper}>
            <PlayerControls
              track={currentTrack}
              isPlaying={isPlaying}
              onToggle={togglePlayback}
              onNext={() => playAdjacent(1)}
              onPrevious={() => playAdjacent(-1)}
              position={position}
              duration={duration}
            />
          </View>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  safeArea: {
    flex: 1
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 10
  },
  header: {
    alignItems: 'center',
    marginBottom: 12
  },
  appTitle: {
    fontSize: 29,
    fontWeight: '800',
    color: '#22d3ee',
    marginBottom: 4
  },
  subtitle: {
    fontSize: 12,
    color: '#8aa5b2'
  },
  version: {
    fontSize: 8.5,
    letterSpacing: 1.2,
    color: '#4f6b78',
    marginTop: 5,
    fontWeight: '700'
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14
  },
  statPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.12)'
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#eaf6fb'
  },
  statLabel: {
    fontSize: 9.5,
    color: '#7fa6b8',
    marginTop: 1
  },
  importToggleBtn: {
    borderRadius: 13,
    overflow: 'hidden',
    elevation: 8,
    marginBottom: 15
  },
  importToggleGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 13
  },
  importToggleText: {
    color: '#04161c',
    fontSize: 14.5,
    fontWeight: '800'
  },
  syncStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -6,
    marginBottom: 14,
    paddingHorizontal: 4
  },
  syncHint: {
    flex: 1,
    fontSize: 11.5,
    color: '#8fd8f0'
  },
  syncButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: -6,
    marginBottom: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.3)',
    backgroundColor: 'rgba(0, 212, 255, 0.07)'
  },
  syncButtonText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#8fd8f0'
  },
  tabsScroll: {
    marginBottom: 18
  },
  tabs: {
    flexDirection: 'row',
    gap: 7,
    paddingRight: 4
  },
  tab: {
    minWidth: 92,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#0a151b',
    borderWidth: 1,
    borderColor: '#172832'
  },
  tabActive: {
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    borderColor: 'rgba(34, 211, 238, 0.5)'
  },
  tabText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#7f99a7'
  },
  tabTextActive: {
    color: '#dff7ff'
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#e7f3f8',
    marginBottom: 12
  },
  sectionHint: {
    fontSize: 11.5,
    color: '#7fa6b8',
    marginTop: -7,
    marginBottom: 14
  },
  resolveHint: {
    fontSize: 11.5,
    color: '#7fd8f5',
    marginBottom: 10
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingRight: 12,
    marginBottom: 6
  },
  backText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8fd8f0'
  },
  collectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -7,
    marginBottom: 14
  },
  collectionSource: {
    fontSize: 9.5,
    letterSpacing: 0.6,
    fontWeight: '700',
    color: '#00d4ff',
    backgroundColor: 'rgba(0, 212, 255, 0.12)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden'
  },
  collectionCount: {
    fontSize: 11.5,
    color: '#7fa6b8'
  },
  moreButton: {
    alignSelf: 'center',
    paddingVertical: 11,
    paddingHorizontal: 18,
    marginTop: 6,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.35)',
    backgroundColor: 'rgba(0, 212, 255, 0.08)'
  },
  moreText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8fd8f0'
  },
  playerWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(10, 27, 35, 0.96)',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 212, 255, 0.2)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 18
  }
});
