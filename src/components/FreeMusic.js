// Legal free-music search for the mobile app.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { searchFreeMusic } from '../services/freeMusicMobile';

const SOURCES = [
  { id: 'all', label: 'Все' },
  { id: 'audius', label: 'Audius' },
  { id: 'ccmixter', label: 'ccMixter' },
  { id: 'archive', label: 'Archive' }
];

const SOURCE_LABELS = {
  audius: 'AUDIUS',
  ccmixter: 'CCMIXTER',
  archive: 'ARCHIVE'
};

function formatDuration(milliseconds) {
  const total = Math.max(0, Math.floor((milliseconds || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function licenseLabel(track) {
  const raw = track.license && !/^https?:/i.test(track.license)
    ? track.license
    : track.licenseUrl || track.license || '';
  const match = String(raw).match(/creativecommons\.org\/(?:licenses|publicdomain)\/([^/]+)(?:\/([0-9.]+))?/i);
  if (match) return `CC ${match[1].toUpperCase()}${match[2] ? ` ${match[2]}` : ''}`;
  return raw || 'Лицензия не указана';
}

const FreeMusic = ({ tracks = [], onPlayTrack, onDownloadTrack }) => {
  const [query, setQuery] = useState('lofi');
  const [source, setSource] = useState('all');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);
  const requestRef = useRef(0);

  const libraryById = useMemo(() => {
    const map = new Map();
    tracks.forEach((track) => map.set(track.id, track));
    return map;
  }, [tracks]);

  const runSearch = async (nextQuery, nextSource) => {
    const value = String(nextQuery === undefined ? query : nextQuery).trim() || 'lofi';
    const next = nextSource || source;
    requestRef.current += 1;
    const request = requestRef.current;
    setQuery(value);
    setLoading(true);
    setError('');
    setStatus('Ищем в легальных каталогах…');
    try {
      const data = await searchFreeMusic(value, next);
      if (request !== requestRef.current) return;
      setResults(data.tracks);
      setSearched(true);
      const counts = data.counts || {};
      const parts = ['audius', 'ccmixter', 'archive']
        .filter((key) => counts[key])
        .map((key) => `${SOURCE_LABELS[key].replace('CCMIXTER', 'ccMixter').replace('ARCHIVE', 'Archive')} ${counts[key]}`);
      setStatus(`Найдено ${data.tracks.length}${parts.length ? ` · ${parts.join(' · ')}` : ''}`);
      if (data.warnings && data.warnings.length) {
        setError(data.warnings[0]);
      }
    } catch (searchError) {
      if (request !== requestRef.current) return;
      setResults([]);
      setSearched(true);
      setStatus('');
      setError(searchError.message || 'Не удалось выполнить поиск');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    runSearch('lofi', 'all');
    // The first search is intentionally started only when this tab is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseSource = (nextSource) => {
    setSource(nextSource);
    runSearch(query, nextSource);
  };

  const download = async (track) => {
    if (downloadingId) return;
    setDownloadingId(track.id);
    try {
      const result = await onDownloadTrack(track);
      if (result && result.path) {
        setStatus(`Скачано: ${result.name || track.title}`);
      }
    } catch (downloadError) {
      Alert.alert('Не удалось скачать', downloadError.message || 'Проверьте подключение к интернету');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title}>Свободная музыка</Text>
        <Text style={styles.subtitle}>
          Audius, ccMixter и Internet Archive. Только треки с открытыми лицензиями.
        </Text>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="lofi, jazz, ambient…"
          placeholderTextColor="#5d7c8b"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => runSearch()}
        />
        <TouchableOpacity
          style={styles.searchButton}
          onPress={() => runSearch()}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.searchButtonText}>Найти</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.chips}>
        {SOURCES.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.chip, source === item.id && styles.chipActive]}
            onPress={() => chooseSource(item.id)}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, source === item.id && styles.chipTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color="#22d3ee" />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : status ? (
        <Text style={styles.statusText}>{status}</Text>
      ) : null}
      {!!error && <Text style={styles.errorText}>{error}</Text>}

      {!results.length && !loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>◎</Text>
          <Text style={styles.emptyTitle}>
            {searched ? 'Ничего не найдено' : 'Найдите музыку'}
          </Text>
          <Text style={styles.emptyText}>
            Попробуйте lofi, jazz, ambient или piano. Скачивание доступно в ccMixter и Internet Archive.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {results.map((track) => {
            const saved = libraryById.get(track.id);
            const downloaded = !!(saved && saved.path);
            const isDownloading = downloadingId === track.id;
            return (
              <TouchableOpacity
                key={track.id}
                style={[styles.row, saved && styles.rowSaved]}
                onPress={() => onPlayTrack(track)}
                activeOpacity={0.82}
              >
                <View style={styles.cover}>
                  {track.image ? (
                    <Image source={{ uri: track.image }} style={styles.coverImage} />
                  ) : (
                    <Text style={styles.coverIcon}>♪</Text>
                  )}
                </View>
                <View style={styles.main}>
                  <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
                  <Text style={styles.artist} numberOfLines={1}>
                    {track.artist}{track.album && track.album !== track.artist ? ` • ${track.album}` : ''}
                  </Text>
                  <View style={styles.meta}>
                    <Text style={styles.badge}>{SOURCE_LABELS[track.source] || track.source}</Text>
                    <Text style={styles.license} numberOfLines={1}>{licenseLabel(track)}</Text>
                  </View>
                </View>
                <View style={styles.right}>
                  <Text style={styles.duration}>{formatDuration(track.duration)}</Text>
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={styles.playButton}
                      onPress={() => onPlayTrack(track)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.playText}>▶</Text>
                    </TouchableOpacity>
                    {track.downloadable ? (
                      <TouchableOpacity
                        style={[styles.downloadButton, downloaded && styles.downloadedButton]}
                        onPress={() => download(track)}
                        disabled={isDownloading || downloaded}
                        activeOpacity={0.8}
                      >
                        {isDownloading ? (
                          <ActivityIndicator size="small" color="#22d3ee" />
                        ) : (
                          <Text style={[styles.downloadText, downloaded && styles.downloadedText]}>
                            {downloaded ? '✓' : '↓'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.streamText}>СТРИМ</Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Text style={styles.footnote}>
        Перед публичным использованием проверьте условия лицензии. Некоторые треки разрешены только для некоммерческого использования.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  head: { marginTop: 4, marginBottom: 14 },
  title: { fontSize: 24, fontWeight: '800', color: '#e7f3f8', letterSpacing: 0.2 },
  subtitle: { fontSize: 12, color: '#7f99a7', lineHeight: 18, marginTop: 5 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 13,
    color: '#e7f3f8',
    backgroundColor: '#0a151b',
    borderWidth: 1,
    borderColor: '#172832',
    fontSize: 13
  },
  searchButton: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22d3ee'
  },
  searchButtonText: { color: '#04161c', fontWeight: '800', fontSize: 13 },
  chips: { flexDirection: 'row', gap: 7, marginBottom: 13, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#0a151b',
    borderWidth: 1,
    borderColor: '#172832'
  },
  chipActive: { backgroundColor: 'rgba(34,211,238,0.12)', borderColor: 'rgba(34,211,238,0.55)' },
  chipText: { fontSize: 11, color: '#7f99a7', fontWeight: '600' },
  chipTextActive: { color: '#22d3ee' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  statusText: { fontSize: 11.5, color: '#22d3ee', marginBottom: 8 },
  errorText: { fontSize: 11.5, color: '#fca5a5', marginBottom: 8, lineHeight: 17 },
  list: { gap: 7 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 9,
    borderRadius: 14,
    backgroundColor: '#0a151b',
    borderWidth: 1,
    borderColor: '#172832'
  },
  rowSaved: { borderColor: 'rgba(34,211,238,0.28)' },
  cover: {
    width: 42,
    height: 42,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,211,238,0.1)'
  },
  coverImage: { width: '100%', height: '100%' },
  coverIcon: { fontSize: 19, color: '#22d3ee' },
  main: { flex: 1, minWidth: 0 },
  trackTitle: { fontSize: 13, fontWeight: '700', color: '#e7f3f8' },
  artist: { fontSize: 10.5, color: '#7f99a7', marginTop: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  badge: {
    fontSize: 7.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#22d3ee',
    backgroundColor: 'rgba(34,211,238,0.1)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden'
  },
  license: { flex: 1, fontSize: 9.5, color: '#6d8793' },
  right: { alignItems: 'flex-end', gap: 5 },
  duration: { fontSize: 10, color: '#6d8793', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playButton: {
    width: 31,
    height: 27,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.28)'
  },
  playText: { color: '#22d3ee', fontSize: 11 },
  downloadButton: {
    width: 31,
    height: 27,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#243d49'
  },
  downloadedButton: { borderColor: 'rgba(34,211,238,0.25)' },
  downloadText: { color: '#a7c0cc', fontSize: 16, lineHeight: 18 },
  downloadedText: { color: '#22d3ee', fontSize: 13 },
  streamText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.4, color: '#7f99a7' },
  empty: {
    alignItems: 'center',
    paddingVertical: 34,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: '#0a151b',
    borderWidth: 1,
    borderColor: '#172832',
    marginTop: 6
  },
  emptyIcon: { fontSize: 32, color: '#22d3ee', marginBottom: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#e7f3f8', marginBottom: 4 },
  emptyText: { fontSize: 11.5, color: '#7f99a7', textAlign: 'center', lineHeight: 17 },
  footnote: { fontSize: 10.5, color: '#5d7c8b', lineHeight: 16, marginTop: 14, marginBottom: 4 }
});

export default FreeMusic;
