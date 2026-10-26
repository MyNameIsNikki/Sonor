// Сетка плейлистов и альбомов для мобильного приложения
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const SOURCE_LABELS = {
  vk: 'VK',
  yandex: 'ЯНДЕКС',
  spotify: 'SPOTIFY',
  link: 'ССЫЛКА'
};

const CollectionGrid = ({ collections, kind, onOpen }) => {
  if (!collections.length) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>{kind === 'album' ? '💿' : '♫'}</Text>
        <Text style={styles.emptyText}>
          {kind === 'album' ? 'Альбомов пока нет' : 'Плейлистов пока нет'}
        </Text>
        <Text style={styles.emptySubtext}>
          Импортируйте всю медиатеку или добавьте публичную ссылку — плейлисты
          и альбомы появятся здесь автоматически.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {collections.map((collection) => {
        const badge =
          collection.type === 'liked'
            ? 'ЛЮБИМОЕ'
            : SOURCE_LABELS[collection.source] || collection.source || 'ИМПОРТ';
        return (
          <TouchableOpacity
            key={collection.id}
            style={styles.card}
            activeOpacity={0.8}
            onPress={() => onOpen(collection)}
          >
            <View style={styles.coverWrap}>
              {collection.image ? (
                <Image source={{ uri: collection.image }} style={styles.cover} />
              ) : (
                <LinearGradient colors={['#123a4d', '#0b2532']} style={styles.coverPlaceholder}>
                  <Text style={styles.coverIcon}>{kind === 'album' ? '💿' : '♫'}</Text>
                </LinearGradient>
              )}
              <Text style={styles.badge}>{badge}</Text>
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {collection.title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {collection.subtitle ||
                `${collection.trackIds.length} ${collection.trackIds.length === 1 ? 'трек' : 'треков'}`}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12
  },
  card: {
    width: '48%',
    marginBottom: 8
  },
  coverWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.18)',
    marginBottom: 8
  },
  cover: {
    width: '100%',
    height: '100%'
  },
  coverPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center'
  },
  coverIcon: {
    fontSize: 44,
    color: '#00d4ff'
  },
  badge: {
    position: 'absolute',
    left: 8,
    top: 8,
    fontSize: 8,
    letterSpacing: 0.7,
    fontWeight: '700',
    color: '#dff7ff',
    backgroundColor: 'rgba(4, 20, 28, 0.72)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden'
  },
  title: {
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '700',
    color: '#eaf6fb'
  },
  subtitle: {
    fontSize: 11,
    color: '#8fb2c2',
    marginTop: 2
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20
  },
  emptyIcon: {
    fontSize: 38,
    color: '#00d4ff',
    marginBottom: 10
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#eaf6fb',
    marginBottom: 6
  },
  emptySubtext: {
    fontSize: 12.5,
    color: '#7fa6b8',
    textAlign: 'center',
    lineHeight: 19
  }
});

export default CollectionGrid;
