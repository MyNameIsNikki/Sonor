// Player controls with live progress and previous/next navigation
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const SOURCE_LABELS = {
  local: 'ЛОКАЛЬНО',
  vk: 'VK',
  yandex: 'ЯНДЕКС',
  spotify: 'SPOTIFY'
};

const PlayerControls = ({
  track,
  isPlaying,
  onToggle,
  onNext,
  onPrevious,
  position = 0,
  duration = 0
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 450,
      useNativeDriver: true
    }).start();
  }, [fadeAnim]);

  const total = duration || track?.duration || 0;
  const progress = total > 0 ? Math.min(100, (position / total) * 100) : 0;

  const formatTime = (milliseconds) => {
    const totalSeconds = Math.max(0, Math.floor((milliseconds || 0) / 1000));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <Animated.View style={[styles.playerContainer, { opacity: fadeAnim }]}>
      <View style={styles.trackInfo}>
        <LinearGradient colors={['#00d4ff', '#0077a8']} style={styles.albumPlaceholder}>
          <Text style={styles.albumIcon}>♪</Text>
        </LinearGradient>
        <View style={styles.trackDetails}>
          <Text style={styles.trackTitle} numberOfLines={1}>
            {track?.title || 'Моя любимая песня'}
          </Text>
          <View style={styles.artistRow}>
            <Text style={styles.artistName} numberOfLines={1}>
              {track?.artist || 'Неизвестный артист'}
            </Text>
            {track?.source ? (
              <Text style={styles.sourceBadge}>
                {SOURCE_LABELS[track.source] || track.source}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.progressSection}>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{formatTime(position)}</Text>
          <Text style={styles.timeText}>{formatTime(total)}</Text>
        </View>
      </View>

      <View style={styles.controlsContainer}>
        <TouchableOpacity style={styles.controlBtn} onPress={onPrevious}>
          <Text style={styles.controlIcon}>⏮</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.playBtn} onPress={onToggle} activeOpacity={0.85}>
          <LinearGradient colors={['#4facfe', '#00d4ff']} style={styles.playGradient}>
            <Text style={isPlaying ? styles.pauseIcon : styles.playIcon}>
              {isPlaying ? '⏸' : '▶'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlBtn} onPress={onNext}>
          <Text style={styles.controlIcon}>⏭</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  playerContainer: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 22
  },
  trackInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14
  },
  albumPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#00d4ff',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6
  },
  albumIcon: {
    fontSize: 24,
    color: '#04222b',
    fontWeight: 'bold'
  },
  trackDetails: {
    flex: 1
  },
  trackTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2
  },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4
  },
  artistName: {
    fontSize: 12,
    color: '#a0c4d8',
    flexShrink: 1
  },
  sourceBadge: {
    fontSize: 9,
    letterSpacing: 0.6,
    color: '#00d4ff',
    backgroundColor: 'rgba(0, 212, 255, 0.12)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden'
  },
  progressSection: {
    marginBottom: 12
  },
  progressBarBg: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 999,
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#00d4ff',
    borderRadius: 999
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6
  },
  timeText: {
    fontSize: 10.5,
    color: '#7fa6b8',
    fontVariant: ['tabular-nums']
  },
  controlsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 26
  },
  controlBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  playBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#00d4ff',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16
  },
  playGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center'
  },
  controlIcon: {
    fontSize: 17,
    color: '#eaf6fb'
  },
  playIcon: {
    fontSize: 23,
    color: '#032730',
    marginLeft: 3
  },
  pauseIcon: {
    fontSize: 23,
    color: '#032730'
  }
});

export default PlayerControls;
