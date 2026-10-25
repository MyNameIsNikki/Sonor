// Enhanced Main Application Entry Point for Cool Music Player
import React, { useState, useEffect } from 'react';
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
import { BlurView } from 'expo-blur';
import { Audio } from 'expo-av';
import * as MediaLibrary from 'expo-media-library';
import MusicImporter from './src/components/MusicImporter';
import PlayerControls from './src/components/PlayerControls';
import TrackList from './src/components/TrackList';
import { importVKMusic, importYandexMusic, importSpotify } from './src/services/musicImport';

export default function App() {
 const [sound, setSound] = useState(null);
 const [isPlaying, setIsPlaying] = useState(false);
 const [currentTrack, setCurrentTrack] = useState(null);
 const [tracks, setTracks] = useState([]);
 const [showImport, setShowImport] = useState(false);
 const [isLoading, setIsLoading] = useState(false);

 // Load saved tracks on app start
 useEffect(() => {
 loadSavedTracks();
 return sound;
 }, []);

 const loadSavedTracks = async () => {
 try {
 const savedTracks = await MediaLibrary.getAssetsAsync({
 mediaType: 'audio',
 first: 100,
 });
 if (savedTracks.assets.length > 0) {
 setTracks(savedTracks.assets.map((asset, index) => ({
 id: asset.id,
 title: asset.filename,
 artist: 'Local Track',
 duration: asset.duration,
 uri: asset.uri
 })));
 }
 } catch (error) {
 console.log('No local tracks found or permission denied');
 }
 };

 const handleImportComplete = (newTracks) => {
 setTracks(prev => [...prev, ...newTracks]);
 setShowImport(false);
 Alert.alert('Успешно!', `Импортировано ${newTracks.length} треков`);
 };

 const handlePlayTrack = async (track) => {
 try {
 // Stop previous sound
 if (sound) {
 await sound.unloadAsync();
 }
 
 // Play new track
 const { sound: newSound } = await Audio.Sound.createAsync(
 { uri: track.uri },
 { shouldPlay: true }
 );
 
 setSound(newSound);
 setIsPlaying(true);
 setCurrentTrack(track);
 } catch (error) {
 console.error('Error playing track:', error);
 Alert.alert('Ошибка', 'Не удалось воспроизвести трек');
 }
 };

 const togglePlayback = async () => {
 if (sound) {
 if (isPlaying) {
 await sound.pauseAsync();
 } else {
 await sound.playAsync();
 }
 setIsPlaying(!isPlaying);
 }
 };

 return (
 <LinearGradient colors={['#0f2027', '#203345', '#2c5364']} style={styles.container}>
 <SafeAreaView style={styles.safeArea}>
 <StatusBar barStyle="light-content" />
 
 <ScrollView contentContainerStyle={styles.scrollContent}>
 {/* Header */}
 <View style={styles.header}>
 <Text style={styles.appTitle}>🎧 Музыкальный плеер</Text>
 <Text style={styles.subtitle}>Синяя тема • VK • Яндекс • Spotify</Text>
 </View>
 
 {/* Import Button */}
 <TouchableOpacity 
 style={styles.importToggleBtn}
 onPress={() => setShowImport(!showImport)}
 >
 <LinearGradient 
 colors={['#00d4ff', '#0099cc']} 
 style={styles.importToggleGradient}
 >
 <Text style={styles.importToggleText}>
 {showImport ? 'Скрыть импорт' : '📥 Импорт музыки'}
 </Text>
 </LinearGradient>
 </TouchableOpacity>
 
 {/* Import Section */}
 {showImport && (
 <MusicImporter onImportComplete={handleImportComplete} />
 )}
 
 {/* Track List */}
 <View style={styles.trackListSection}>
 <Text style={styles.sectionTitle}>Мои треки ({tracks.length})</Text>
 <TrackList 
 tracks={tracks} 
 onPlayTrack={handlePlayTrack}
 currentTrack={currentTrack}
 />
 </View>
 </ScrollView>
 
 {/* Player Controls - Fixed at bottom */}
 {currentTrack && (
 <View style={styles.playerWrapper}>
 <PlayerControls 
 track={currentTrack}
 isPlaying={isPlaying}
 onToggle={togglePlayback}
 />
 </View>
 )}
 </SafeAreaView>
 </LinearGradient>
 );
}

const styles = StyleSheet.create({
 container: {
 flex: 1,
 },
 safeArea: {
 flex: 1,
 },
 scrollContent: {
 flexGrow: 1,
 padding: 20,
 paddingBottom: 100,
 },
 header: {
 alignItems: 'center',
 marginBottom: 25,
 },
 appTitle: {
 fontSize: 32,
 fontWeight: 'bold',
 color: '#00d4ff',
 marginBottom: 5,
 textShadowColor: 'rgba(0,212,255,0.3)',
 textShadowOffset: { width: 0, height: 0 },
 textShadowRadius: 10,
 },
 subtitle: {
 fontSize: 14,
 color: '#a0c4d8',
 },
 importToggleBtn: {
 borderRadius: 12,
 overflow: 'hidden',
 elevation: 8,
 marginBottom: 15,
 },
 importToggleGradient: {
 padding: 15,
 alignItems: 'center',
 borderRadius: 12,
 },
 importToggleText: {
 color: '#fff',
 fontSize: 16,
 fontWeight: 'bold',
 },
 trackListSection: {
 marginTop: 10,
 },
 sectionTitle: {
 fontSize: 18,
 fontWeight: 'bold',
 color: '#00d4ff',
 marginBottom: 15,
 },
 playerWrapper: {
 position: 'absolute',
 bottom: 0,
 left: 0,
 right: 0,
 backgroundColor: 'rgba(15, 32, 39, 0.9)',
 borderTopLeftRadius: 20,
 borderTopRightRadius: 20,
 paddingTop: 10,
 paddingBottom: 20,
 borderTopWidth: 1,
 borderTopColor: 'rgba(0, 212, 255, 0.2)',
 },
});