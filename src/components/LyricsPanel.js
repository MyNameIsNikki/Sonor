// Полноэкранная панель текста песни: LRCLib, подсветка строки и переход по тапу.
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { lookupLyrics } from '../services/lyricsMobile';

const OFFSET_KEY = 'sonor_lyrics_offset';
const MAX_OFFSET = 15000;

function clampOffset(value) {
  return Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, Number(value) || 0));
}

function offsetText(value) {
  const seconds = value / 1000;
  return `${seconds > 0 ? '+' : ''}${seconds.toFixed(1).replace('.', ',')} с`;
}

const LyricsPanel = ({ visible, track, position = 0, onClose, onSeek }) => {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const scrollRef = useRef(null);
  const linePositions = useRef({});

  useEffect(() => {
    let alive = true;
    SecureStore.getItemAsync(OFFSET_KEY)
      .then((value) => {
        if (alive && value) setOffset(clampOffset(Number(value)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    if (!track) {
      setLoading(false);
      setResult(null);
      return undefined;
    }

    let alive = true;
    setLoading(true);
    setResult(null);
    linePositions.current = {};

    lookupLyrics({
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || '',
      duration: track.duration || 0
    })
      .then((data) => {
        if (!alive) return;
        setResult(data);
        setLoading(false);
      })
      .catch((error) => {
        if (!alive) return;
        setResult({
          found: false,
          synced: false,
          lines: [],
          plain: '',
          error: (error && error.message) || 'Не удалось загрузить текст'
        });
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [
    visible,
    retryToken,
    track && track.id,
    track && track.title,
    track && track.artist,
    track && track.album,
    track && track.duration
  ]);

  const lines = (result && result.synced && Array.isArray(result.lines)) ? result.lines : [];
  const canSync = lines.length > 0;
  const effectivePosition = position - offset;
  let activeIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time * 1000 <= effectivePosition + 70) activeIndex = i;
    else break;
  }

  const scrollToLine = (index, animated) => {
    const y = linePositions.current[index];
    if (typeof y !== 'number' || !scrollRef.current) return false;
    scrollRef.current.scrollTo({ y: Math.max(0, y - 130), animated: animated !== false });
    return true;
  };

  useEffect(() => {
    if (!visible) return;
    if (activeIndex < 0) {
      if (scrollRef.current) scrollRef.current.scrollTo({ y: 0, animated: false });
      return;
    }
    // При первом открытии разметка строк ещё может быть не готова.
    // Повторный вызов будет из onLayout активной строки.
    scrollToLine(activeIndex, true);
  }, [activeIndex, visible]);

  const changeOffset = (delta) => {
    setOffset((current) => {
      const next = clampOffset(current + delta);
      SecureStore.setItemAsync(OFFSET_KEY, String(next)).catch(() => {});
      return next;
    });
  };

  const seekTo = (seconds) => {
    if (typeof onSeek !== 'function') return;
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) return;
    // Компенсируем задержку, иначе после тапа активной окажется другая строка.
    onSeek(Math.round((value + offset / 1000) * 1000));
  };

  const retry = () => setRetryToken((value) => value + 1);

  const renderState = (title, note, withRetry) => (
    <View style={styles.state}>
      <Text style={styles.stateTitle}>{title}</Text>
      {note ? <Text style={styles.stateNote}>{note}</Text> : null}
      {withRetry ? (
        <TouchableOpacity style={styles.retryBtn} onPress={retry} activeOpacity={0.82}>
          <Text style={styles.retryText}>Попробовать снова</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.state}>
          <ActivityIndicator color="#22d3ee" />
          <Text style={styles.stateTitle}>Ищем текст…</Text>
          <Text style={styles.stateNote}>LRCLib · обычно это занимает пару секунд</Text>
        </View>
      );
    }
    if (!result) {
      return renderState('Включите трек', 'Sonor попробует найти текст для текущей песни.', false);
    }
    if (result.error) {
      return renderState('Не удалось загрузить текст', result.error, true);
    }
    if (!result.found) {
      return renderState(
        'Текст не найден',
        'LRCLib не нашёл эту песню. Попробуйте другой трек или повторите поиск.',
        true
      );
    }
    if (result.instrumental && !result.plain && !lines.length) {
      return renderState('Инструментальная композиция', 'Для этого трека текст не предусмотрен.', false);
    }
    if (!lines.length) {
      if (!result.plain) {
        return renderState('Текст не найден', 'Для этого трека нет ни синхронизированного, ни обычного текста.', true);
      }
      return <Text style={styles.plain}>{result.plain}</Text>;
    }

    return (
      <View>
        {lines.map((line, index) => {
          const isActive = index === activeIndex;
          const empty = !line.text;
          return (
            <TouchableOpacity
              key={`${index}-${line.time}`}
              style={[styles.line, isActive && styles.lineActive]}
              activeOpacity={0.75}
              onPress={() => seekTo(line.time)}
              onLayout={(event) => {
                const y = event.nativeEvent.layout.y;
                linePositions.current[index] = y;
                if (index === activeIndex) scrollToLine(index, false);
              }}
            >
              <Text
                style={[
                  styles.lineText,
                  empty && styles.lineTextEmpty,
                  isActive && styles.lineTextActive
                ]}
              >
                {empty ? '♪' : line.text}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.kicker}>ТЕКСТ ПЕСНИ</Text>
              <Text style={styles.title} numberOfLines={1}>
                {track ? track.title : 'Ничего не играет'}
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                {track ? [track.artist, track.album].filter(Boolean).join(' · ') : 'Включите трек'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel="Закрыть текст песни"
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.toolbar}>
            <TouchableOpacity
              style={[styles.offsetBtn, !canSync && styles.offsetBtnDisabled]}
              onPress={() => changeOffset(-500)}
              disabled={!canSync}
              activeOpacity={0.8}
              accessibilityLabel="Уменьшить задержку текста на полсекунды"
            >
              <Text style={styles.offsetBtnText}>−0,5 с</Text>
            </TouchableOpacity>
            <View style={styles.offsetCenter}>
              <Text style={styles.offsetLabel}>Задержка {offsetText(offset)}</Text>
              <Text style={styles.offsetHint}>
                {canSync ? 'СИНХРОНИЗАЦИЯ' : 'LRCLIB'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.offsetBtn, !canSync && styles.offsetBtnDisabled]}
              onPress={() => changeOffset(500)}
              disabled={!canSync}
              activeOpacity={0.8}
              accessibilityLabel="Увеличить задержку текста на полсекунды"
            >
              <Text style={styles.offsetBtnText}>+0,5 с</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              if (activeIndex >= 0) scrollToLine(activeIndex, false);
            }}
          >
            {renderBody()}
          </ScrollView>

          <Text style={styles.footnote}>
            Тексты: LRCLib · нажмите строку, чтобы перейти к моменту
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 8, 12, 0.68)'
  },
  sheet: {
    height: '88%',
    backgroundColor: '#07141b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.2)',
    paddingTop: 10,
    overflow: 'hidden'
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(34, 211, 238, 0.28)',
    marginBottom: 12
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20
  },
  headerText: {
    flex: 1
  },
  kicker: {
    color: '#22d3ee',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.4
  },
  title: {
    color: '#eef9fd',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 5
  },
  artist: {
    color: '#7f9fac',
    fontSize: 11.5,
    marginTop: 3
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  closeText: {
    color: '#9db9c5',
    fontSize: 15,
    fontWeight: '700'
  },
  toolbar: {
    marginTop: 14,
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  offsetBtn: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.22)',
    backgroundColor: 'rgba(34, 211, 238, 0.06)'
  },
  offsetBtnDisabled: {
    opacity: 0.38
  },
  offsetBtnText: {
    color: '#22d3ee',
    fontSize: 10.5,
    fontWeight: '700'
  },
  offsetCenter: {
    flex: 1,
    alignItems: 'center'
  },
  offsetLabel: {
    color: '#9db9c5',
    fontSize: 10.5,
    fontWeight: '600'
  },
  offsetHint: {
    color: '#4f6f7d',
    fontSize: 8,
    letterSpacing: 1.1,
    marginTop: 3,
    fontWeight: '700'
  },
  scroll: {
    flex: 1
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 40
  },
  line: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginHorizontal: -10,
    borderRadius: 8
  },
  lineActive: {
    backgroundColor: 'rgba(34, 211, 238, 0.08)'
  },
  lineText: {
    color: '#6f8b98',
    fontSize: 16,
    lineHeight: 25
  },
  lineTextEmpty: {
    color: '#4b6673',
    fontSize: 13
  },
  lineTextActive: {
    color: '#22d3ee',
    fontWeight: '700'
  },
  plain: {
    color: '#a8c3cf',
    fontSize: 14,
    lineHeight: 24
  },
  state: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 52,
    paddingHorizontal: 16,
    gap: 9
  },
  stateTitle: {
    color: '#dceef5',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center'
  },
  stateNote: {
    color: '#6f8b98',
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: 'center'
  },
  retryBtn: {
    marginTop: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 9,
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.28)'
  },
  retryText: {
    color: '#22d3ee',
    fontSize: 11,
    fontWeight: '800'
  },
  footnote: {
    color: '#4f6f7d',
    fontSize: 9.5,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 30 : 20
  }
});

export default LyricsPanel;
