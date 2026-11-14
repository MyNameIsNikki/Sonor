// Player controls with live progress, tap-to-seek and a lyrics shortcut
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

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

const PlayerControls = ({
  track,
  isPlaying,
  onToggle,
  onNext,
  onPrevious,
  onSeek,
  onOpenLyrics,
  lyricsOpen = false,
  position = 0,
  duration = 0
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const barWidth = useRef(0);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 450,
      useNativeDriver: true
    }).start();
  }, [fadeAnim]);

  const numericDuration = Number(duration);
  const trackDuration = Number(track?.duration);
  const total = Number.isFinite(numericDuration) && numericDuration > 0
    ? numericDuration
    : (Number.isFinite(trackDuration) && trackDuration > 0 ? trackDuration : 0);
  const numericPosition = Number(position);
  const safePosition = Number.isFinite(numericPosition) ? Math.max(0, numericPosition) : 0;
  const boundedPosition = total > 0 ? Math.min(safePosition, total) : 0;
  const progress = total > 0 ? Math.min(100, Math.max(0, (boundedPosition / total) * 100)) : 0;

  const formatTime = (milliseconds) => {
    const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleSeek = (event) => {
    if (!onSeek || !total || !barWidth.current) return;
    const location = event && event.nativeEvent ? Number(event.nativeEvent.locationX) : NaN;
    if (!Number.isFinite(location)) return;
    const ratio = Math.max(0, Math.min(1, location / barWidth.current));
    onSeek(Math.round(ratio * total));
  };

  const seekBy = (delta) => {
    if (!onSeek || !total) return;
    onSeek(Math.max(0, Math.min(total, Math.round(boundedPosition + delta))));
  };

  return (
    <Animated.View style={[styles.playerContainer, { opacity: fadeAnim }]}>
      <View style={styles.trackInfo}>
        <LinearGradient colors={['#22d3ee', '#0891b2']} style={styles.albumPlaceholder}>
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
          {track?.album ? (
            <Text style={styles.albumName} numberOfLines={1}>
              {track.album}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={[styles.lyricsBtn, lyricsOpen && styles.lyricsBtnActive]}
          onPress={onOpenLyrics}
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityLabel="Текст песни"
          accessibilityState={{ selected: !!lyricsOpen }}
        >
          <Text style={[styles.lyricsBtnText, lyricsOpen && styles.lyricsBtnTextActive]}>Aa</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.progressSection}>
        <Pressable
          style={styles.progressTouch}
          onLayout={(event) => {
            barWidth.current = event.nativeEvent.layout.width;
          }}
          onPress={handleSeek}
          hitSlop={10}
          accessibilityRole="adjustable"
          accessibilityLabel="Позиция трека"
          accessibilityValue={{
            min: 0,
            max: Math.round(total),
            now: Math.round(boundedPosition),
            text: `${formatTime(boundedPosition)} из ${formatTime(total)}`
          }}
          accessibilityActions={[
            { name: 'increment', label: 'Вперёд на 10 секунд' },
            { name: 'decrement', label: 'Назад на 10 секунд' }
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') seekBy(10000);
            else if (event.nativeEvent.actionName === 'decrement') seekBy(-10000);
          }}
        >
          <View style={styles.progressBarBg}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
        </Pressable>
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{formatTime(boundedPosition)}</Text>
          <Text style={styles.timeText}>{formatTime(total)}</Text>
        </View>
      </View>

      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={onPrevious}
          accessibilityRole="button"
          accessibilityLabel="Предыдущий трек"
        >
          <Text style={styles.controlIcon}>⏮</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.playBtn}
          onPress={onToggle}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Пауза' : 'Воспроизвести'}
          accessibilityState={{ selected: isPlaying }}
        >
          <LinearGradient colors={['#22d3ee', '#06b6d4']} style={styles.playGradient}>
            <Text style={isPlaying ? styles.pauseIcon : styles.playIcon}>
              {isPlaying ? '⏸' : '▶'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlBtn}
          onPress={onNext}
          accessibilityRole="button"
          accessibilityLabel="Следующий трек"
        >
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
  lyricsBtn: {
    width: 36,
    height: 36,
    flex: 0,
    borderRadius: 12,
    backgroundColor: 'rgba(34, 211, 238, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.22)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  lyricsBtnActive: {
    backgroundColor: '#22d3ee',
    borderColor: '#22d3ee'
  },
  lyricsBtnText: {
    color: '#22d3ee',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.4
  },
  lyricsBtnTextActive: {
    color: '#04161c'
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
  albumName: {
    fontSize: 10.5,
    color: '#6f95a6',
    marginTop: 2
  },
  sourceBadge: {
    fontSize: 9,
    letterSpacing: 0.6,
    color: '#22d3ee',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden'
  },
  progressSection: {
    marginBottom: 8
  },
  progressTouch: {
    paddingVertical: 8,
    marginTop: -6
  },
  progressBarBg: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 999,
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#22d3ee',
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
