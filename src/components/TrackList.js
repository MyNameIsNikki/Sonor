// Track list rendered as simple rows (avoids nested VirtualizedList inside ScrollView)
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';

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

const TrackList = ({ tracks, onPlayTrack, currentTrack }) => {
  const formatDuration = (milliseconds) => {
    const totalSeconds = Math.max(0, Math.floor((milliseconds || 0) / 1000));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (tracks.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>🎧</Text>
        <Text style={styles.emptyText}>Нет треков</Text>
        <Text style={styles.emptySubtext}>
          Импортируйте музыку из VK, Яндекс Музыки или Spotify, добавьте публичную
          ссылку либо локальные файлы на устройстве
        </Text>
      </View>
    );
  }

  return (
    <View>
      {tracks.map((item, index) => {
        const isCurrent = currentTrack?.id === item.id;
        return (
          <TouchableOpacity
            key={item.id ? item.id.toString() : String(index)}
            style={[styles.trackItem, isCurrent && styles.currentTrack]}
            onPress={() => onPlayTrack(item)}
            activeOpacity={0.75}
          >
            <View style={[styles.trackBlur, isCurrent && styles.trackBlurCurrent]}>
              <View style={styles.trackInfo}>
                <View style={[styles.artwork, isCurrent && styles.currentArtwork]}>
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={styles.artworkImage} />
                  ) : (
                    <Text style={[styles.trackNumberText, isCurrent && styles.currentTrackNumberText]}>
                      {isCurrent ? '▶' : index + 1}
                    </Text>
                  )}
                </View>
                <View style={styles.trackDetails}>
                  <Text style={styles.trackTitle} numberOfLines={1}>
                    {item.title || 'Без названия'}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.artistName} numberOfLines={1}>
                      {item.artist || 'Неизвестно'}
                    </Text>
                    {item.source ? (
                      <Text style={styles.sourceBadge}>
                        {item.source === 'link' && item.provider
                          ? SOURCE_LABELS[item.provider] || SOURCE_LABELS.link
                          : SOURCE_LABELS[item.source] || item.source}
                      </Text>
                    ) : null}
                  </View>
                  {item.album ? (
                    <Text style={styles.albumName} numberOfLines={1}>
                      {item.album}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Text style={styles.trackDuration}>
                {item.duration ? formatDuration(item.duration) : '--:--'}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  trackItem: {
    marginBottom: 8,
    borderRadius: 14,
    overflow: 'hidden'
  },
  currentTrack: {
    borderWidth: 0
  },
  trackBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    backgroundColor: '#0a151b',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#172832'
  },
  trackBlurCurrent: {
    borderColor: 'rgba(34, 211, 238, 0.42)',
    backgroundColor: 'rgba(34, 211, 238, 0.055)'
  },
  trackInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    flex: 1,
    minWidth: 0
  },
  artwork: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 212, 255, 0.14)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden'
  },
  currentArtwork: {
    borderWidth: 1.5,
    borderColor: '#22d3ee'
  },
  artworkImage: {
    width: '100%',
    height: '100%'
  },
  trackNumberText: {
    color: '#bfe6f5',
    fontSize: 12,
    fontWeight: '700'
  },
  currentTrackNumberText: {
    color: '#00d4ff'
  },
  trackDetails: {
    flex: 1,
    minWidth: 0
  },
  trackTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#eaf6fb'
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 3
  },
  artistName: {
    fontSize: 11.5,
    color: '#8fb2c2',
    flexShrink: 1
  },
  albumName: {
    fontSize: 10.5,
    color: '#6f95a6',
    marginTop: 2
  },
  sourceBadge: {
    fontSize: 8.5,
    letterSpacing: 0.5,
    color: '#22d3ee',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 999,
    overflow: 'hidden'
  },
  trackDuration: {
    fontSize: 11,
    color: '#7fa6b8',
    marginLeft: 8,
    fontVariant: ['tabular-nums']
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 44,
    paddingHorizontal: 24
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 10
  },
  emptyText: {
    fontSize: 17,
    color: '#eaf6fb',
    fontWeight: '600',
    marginBottom: 6
  },
  emptySubtext: {
    fontSize: 12.5,
    color: '#7fa6b8',
    textAlign: 'center',
    lineHeight: 19
  }
});

export default TrackList;
