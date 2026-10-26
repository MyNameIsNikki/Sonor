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
  Alert
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import MusicImporter from './src/components/MusicImporter';
import PlayerControls from './src/components/PlayerControls';
import TrackList from './src/components/TrackList';
import CollectionGrid from './src/components/CollectionGrid';
import { resolveYandexStream } from './src/services/musicImport';

const LIBRARY_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}sonor-library.json`
  : null;

const SOURCE_LABELS = {
  local: 'ЛОКАЛЬНО',
  vk: 'VK',
  yandex: 'ЯНДЕКС',
  spotify: 'SPOTIFY'
};

const TABS = [
  { id: 'all', label: 'Все' },
  { id: 'playlists', label: 'Плейлисты' },
  { id: 'albums', label: 'Альбомы' }
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
        .map((track) => ({ ...track, src: track.url || null }));
      setTracks([...localTracks, ...imported]);
      setCollections(saved.collections);
      setLibraryReady(true);
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
          image: track.image || null,
          source: track.source
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

  const startPlayback = async (track, uri) => {
    if (!uri) {
      Alert.alert(
        'Нет ссылки',
        track.source === 'spotify'
          ? 'Spotify отдаёт только 30-секундные превью, и для этого трека оно недоступно.'
          : 'У этого трека нет прямой ссылки. Импортируйте медиатеку заново — ссылки сервисов со временем истекают.'
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
    let uri = track.uri || track.url;

    if (!uri && track.source === 'yandex') {
      const token = tokensRef.current.yandex;
      if (!token) {
        Alert.alert(
          'Нужен токен Яндекса',
          'Ссылки Яндекс Музыки не сохраняются между запусками. Откройте «Импорт музыки», вставьте токен и импортируйте медиатеку заново.'
        );
        return;
      }
      setResolvingTrackId(track.id);
      try {
        const directUrl = await resolveYandexStream(
          track.externalId || String(track.id).replace(/^yandex_/, ''),
          token
        );
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

    try {
      await startPlayback(playable, uri);
    } catch (error) {
      console.error('Ошибка воспроизведения:', error);
      Alert.alert('Ошибка', 'Не удалось воспроизвести трек');
    }
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

  const handleImportComplete = (result, service, token) => {
    tokensRef.current[service] = token;
    const imported = result.tracks.map((track) => ({
      ...track,
      duration: Math.round((track.duration || 0) * 1000),
      src: track.url || null
    }));

    setTracks((previous) => [...previous.filter((track) => track.source !== service), ...imported]);
    setCollections((previous) => [
      ...previous.filter((collection) => collection.source !== service),
      ...(result.collections || [])
    ]);
    setActiveCollectionId(null);
    setActiveTab('all');
    setShowImport(false);
    scrollRef.current?.scrollTo({ y: 0, animated: true });

    const stats = result.stats || {};
    let message = `Треков: ${stats.tracks || imported.length}`;
    if (stats.playlists) message += `\nПлейлистов: ${stats.playlists}`;
    if (stats.albums) message += `\nАльбомов: ${stats.albums}`;
    if (stats.liked) message += `\nЛюбимых треков: ${stats.liked}`;
    if (result.warnings && result.warnings.length) {
      message += `\n\n${result.warnings.slice(0, 3).join('\n')}`;
    }
    Alert.alert('Импорт завершён', message);
  };

  const openCollection = (collection) => {
    setActiveCollectionId(collection.id);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const switchTab = (tab) => {
    setActiveTab(tab);
    setActiveCollectionId(null);
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
            tracks={visibleTracks}
            onPlayTrack={handlePlayTrack}
            currentTrack={currentTrack}
          />
        </View>
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
        <TrackList tracks={tracks} onPlayTrack={handlePlayTrack} currentTrack={currentTrack} />
      </View>
    );
  };

  return (
    <LinearGradient colors={['#0f2027', '#203345', '#2c5364']} style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: currentTrack ? 200 : 40 }
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.appTitle}>🎧 SONOR</Text>
            <Text style={styles.subtitle}>VK • Яндекс Музыка • Spotify</Text>
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
            <LinearGradient colors={['#00d4ff', '#0099cc']} style={styles.importToggleGradient}>
              <Text style={styles.importToggleText}>
                {showImport ? 'Скрыть импорт' : '📥 Импорт всей музыки'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {showImport && <MusicImporter onImportComplete={handleImportComplete} />}

          <View style={styles.tabs}>
            {TABS.map((tab) => {
              const active = activeTab === tab.id && !activeCollectionId;
              const count =
                tab.id === 'playlists'
                  ? playlistCollections.length
                  : tab.id === 'albums'
                    ? albumCollections.length
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
          </View>

          {resolvingTrackId ? (
            <Text style={styles.resolveHint}>Загружаем ссылку из Яндекс Музыки…</Text>
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
    fontSize: 30,
    fontWeight: '800',
    color: '#00d4ff',
    marginBottom: 4,
    textShadowColor: 'rgba(0,212,255,0.3)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12
  },
  subtitle: {
    fontSize: 12.5,
    color: '#a0c4d8'
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
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold'
  },
  tabs: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: 18
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.1)'
  },
  tabActive: {
    backgroundColor: 'rgba(0, 212, 255, 0.16)',
    borderColor: 'rgba(0, 212, 255, 0.45)'
  },
  tabText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#8fb2c2'
  },
  tabTextActive: {
    color: '#dff7ff'
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#00d4ff',
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
