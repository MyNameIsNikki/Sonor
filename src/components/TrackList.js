// Track list rendered as simple rows (avoids nested VirtualizedList inside ScrollView)
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';

const SOURCE_LABELS = {
  local: 'ЛОКАЛЬНО',
  vk: 'VK',
  yandex: 'ЯНДЕКС',
  spotify: 'SPOTIFY'
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
          Импортируйте музыку из VK, Яндекс Музыки или Spotify, либо добавьте
          локальные файлы на устройстве
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
            <BlurView intensity={18} tint="dark" style={styles.trackBlur}>
              <View style={styles.trackInfo}>
                <View style={[styles.trackNumber, isCurrent && styles.currentTrackNumber]}>
                  <Text style={[styles.trackNumberText, isCurrent && styles.currentTrackNumberText]}>
                    {isCurrent ? '▶' : index + 1}
                  </Text>
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
                        {SOURCE_LABELS[item.source] || item.source}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>
              <Text style={styles.trackDuration}>
                {item.duration ? formatDuration(item.duration) : '--:--'}
              </Text>
            </BlurView>
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
    shadowColor: '#00d4ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 6
  },
  trackBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.14)'
  },
  trackInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0
  },
  trackNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0, 212, 255, 0.14)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  currentTrackNumber: {
    backgroundColor: '#00d4ff'
  },
  trackNumberText: {
    color: '#bfe6f5',
    fontSize: 12,
    fontWeight: '700'
  },
  currentTrackNumberText: {
    color: '#032730'
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
  sourceBadge: {
    fontSize: 8.5,
    letterSpacing: 0.5,
    color: '#00d4ff',
    backgroundColor: 'rgba(0, 212, 255, 0.12)',
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
