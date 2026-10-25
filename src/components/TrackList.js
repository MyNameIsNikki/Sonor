// Enhanced Track List Component
import React from 'react';
import { 
 View, 
 Text, 
 TouchableOpacity, 
 FlatList, 
 StyleSheet, 
 Alert 
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

const TrackList = ({ tracks, onPlayTrack, currentTrack }) => {
 const formatDuration = (milliseconds) => {
 const totalSeconds = Math.floor(milliseconds / 1000);
 const mins = Math.floor(totalSeconds / 60);
 const secs = totalSeconds % 60;
 return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
 };

 const renderTrackItem = ({ item }) => {
 const isCurrent = currentTrack?.id === item.id;
 
 return (
 <TouchableOpacity
 style={[styles.trackItem, isCurrent && styles.currentTrack]}
 onPress={() => onPlayTrack(item)}
 >
 <BlurView intensity={20} tint="light" style={styles.trackBlur}>
 <View style={styles.trackInfo}>
 <View style={[styles.trackNumber, isCurrent && styles.currentTrackNumber]}>
 <Text style={styles.trackNumberText}>
 {isCurrent ? '▶' : item.id}
 </Text>
 </View>
 <View style={styles.trackDetails}>
 <Text style={styles.trackTitle}>{item.title || 'Без названия'}</Text>
 <Text style={styles.artistName}>{item.artist || 'Неизвестно'}</Text>
 </View>
 </View>
 <Text style={styles.trackDuration}>
 {item.duration ? formatDuration(item.duration) : '--:--'}
 </Text>
 </BlurView>
 </TouchableOpacity>
 );
 };

 if (tracks.length === 0) {
 return (
 <View style={styles.emptyState}>
 <Text style={styles.emptyText}>Нет треков</Text>
 <Text style={styles.emptySubtext}>
 Используйте кнопку "Импорт музыки" для добавления треков
 </Text>
 </View>
 );
 }

 return (
 <FlatList
 data={tracks}
 renderItem={renderTrackItem}
 keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
 showsVerticalScrollIndicator={false}
 />
 );
};

const styles = StyleSheet.create({
 trackItem: {
 marginBottom: 8,
 borderRadius: 12,
 overflow: 'hidden',
 elevation: 3,
 },
 currentTrack: {
 shadowColor: '#00d4ff',
 shadowOffset: { width: 0, height: 0 },
 shadowOpacity: 0.5,
 shadowRadius: 8,
 },
 trackBlur: {
 flexDirection: 'row',
 alignItems: 'center',
 justifyContent: 'space-between',
 padding: 12,
 backgroundColor: 'rgba(255,255,255,0.1)',
 borderRadius: 12,
 borderWidth: 1,
 borderColor: 'rgba(0,212,255,0.2)',
 },
 trackInfo: {
 flexDirection: 'row',
 alignItems: 'center',
 gap: 12,
 flex: 1,
 },
 trackNumber: {
 width: 30,
 height: 30,
 borderRadius: 15,
 backgroundColor: 'rgba(0, 212, 255, 0.2)',
 justifyContent: 'center',
 alignItems: 'center',
 },
 currentTrackNumber: {
 backgroundColor: '#00d4ff',
 },
 trackNumberText: {
 color: '#fff',
 fontSize: 14,
 fontWeight: 'bold',
 },
 trackDetails: {
 flex: 1,
 },
 trackTitle: {
 fontSize: 14,
 fontWeight: 'bold',
 color: '#fff',
 },
 trackArtist: {
 fontSize: 12,
 color: '#a0c4d8',
 marginTop: 2,
 },
 trackDuration: {
 fontSize: 12,
 color: '#a0c4d8',
 },
 emptyState: {
 alignItems: 'center',
 justifyContent: 'center',
 paddingVertical: 40,
 },
 emptyText: {
 fontSize: 18,
 color: '#a0c4d8',
 marginBottom: 8,
 },
 emptySubtext: {
 fontSize: 13,
 color: '#668',
 textAlign: 'center',
 paddingHorizontal: 40,
 },
});

export default TrackList;