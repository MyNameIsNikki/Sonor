// Enhanced Audio Player Controls Component
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Animated } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';

const PlayerControls = ({ track, isPlaying, onToggle }) => {
 const [progress, setProgress] = useState(0);
 const [duration, setDuration] = useState(0);
 const [position, setPosition] = useState(0);
 const fadeAnim = new Animated.Value(0);

 useEffect(() => {
 // Animate in
 Animated.timing(fadeAnim, {
 toValue: 1,
 duration: 500,
 useNativeDriver: true,
 });
 }, []);

 const formatTime = (milliseconds) => {
 const totalSeconds = Math.floor(milliseconds / 1000);
 const mins = Math.floor(totalSeconds / 60);
 const secs = totalSeconds % 60;
 return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
 };

 return (
 <Animated.View style={[styles.playerContainer, { opacity: fadeAnim }]}>
 <View style={styles.trackInfo}>
 <View style={styles.albumPlaceholder}>
 <LinearGradient 
 colors={['#00d4ff', '#0099cc']} 
 style={styles.albumGradient}
 >
 <Text style={styles.albumIcon}>🎵</Text>
 </LinearGradient>
 </View>
 <View style={styles.trackDetails}>
 <Text style={styles.trackTitle} numberOfLines={1}>
 {track?.title || 'Моя любимая песня'}
 </Text>
 <Text style={styles.artistName} numberOfLines={1}>
 {track?.artist || 'Неизвестный артист'}
 </Text>
 </View>
 </View>
 
 <View style={styles.progressSection}>
 <View style={styles.progressBarBg}>
 <View style={[styles.progressFill, { width: `${progress}%` }]} />
 </View>
 <View style={styles.timeContainer}>
 <Text style={styles.timeText}>{formatTime(position)}</Text>
 <Text style={styles.timeText}>{formatTime(duration)}</Text>
 </View>
 </View>
 
 <View style={styles.controlsContainer}>
 <TouchableOpacity style={styles.controlBtn} onPress={() => Alert.alert('Функция в разработке')}>
 <Text style={styles.controlIcon}>⏪</Text>
 </TouchableOpacity>
 
 <TouchableOpacity style={styles.playBtn} onPress={onToggle}>
 {isPlaying ? (
 <LinearGradient colors={['#00d4ff', '#0099cc']} style={styles.playGradient}>
 <Text style={styles.pauseIcon}>⏸</Text>
 </LinearGradient>
 ) : (
 <LinearGradient colors={['#00d4ff', '#0099cc']} style={styles.playGradient}>
 <Text style={styles.playIcon}>▶</Text>
 </LinearGradient>
 )}
 </TouchableOpacity>
 
 <TouchableOpacity style={styles.controlBtn} onPress={() => Alert.alert('Функция в разработке')}>
 <Text style={styles.controlIcon}>⏩</Text>
 </TouchableOpacity>
 </View>
 </Animated.View>
 );
};

const styles = StyleSheet.create({
 playerContainer: {
 padding: 15,
 paddingBottom: 25,
 },
 trackInfo: {
 flexDirection: 'row',
 alignItems: 'center',
 gap: 15,
 marginBottom: 15,
 },
 albumPlaceholder: {
 width: 55,
 height: 55,
 borderRadius: 8,
 overflow: 'hidden',
 },
 albumGradient: {
 width: '100%',
 height: '100%',
 justifyContent: 'center',
 alignItems: 'center',
 },
 albumIcon: {
 fontSize: 22,
 },
 trackDetails: {
 flex: 1,
 },
 trackTitle: {
 fontSize: 14,
 fontWeight: 'bold',
 color: '#fff',
 },
 artistName: {
 fontSize: 12,
 color: '#a0c4d8',
 marginTop: 2,
 },
 progressSection: {
 marginBottom: 15,
 },
 progressBarBg: {
 height: 4,
 backgroundColor: 'rgba(255, 255, 255, 0.15)',
 borderRadius: 2,
 overflow: 'hidden',
 },
 progressFill: {
 height: '100%',
 backgroundColor: '#00d4ff',
 borderRadius: 2,
 },
 timeContainer: {
 flexDirection: 'row',
 justifyContent: 'space-between',
 marginTop: 5,
 },
 timeText: {
 fontSize: 11,
 color: '#a0c4d8',
 },
 controlsContainer: {
 flexDirection: 'row',
 alignItems: 'center',
 justifyContent: 'center',
 gap: 25,
 },
 controlBtn: {
 width: 40,
 height: 40,
 borderRadius: 20,
 backgroundColor: 'rgba(255, 255, 255, 0.1)',
 justifyContent: 'center',
 alignItems: 'center',
 },
 playBtn: {
 width: 64,
 height: 64,
 borderRadius: 32,
 overflow: 'hidden',
 elevation: 8,
 },
 playGradient: {
 width: '100%',
 height: '100%',
 justifyContent: 'center',
 alignItems: 'center',
 },
 controlIcon: {
 fontSize: 16,
 color: '#fff',
 },
 playIcon: {
 fontSize: 22,
 color: '#0f2027',
 fontWeight: 'bold',
 },
 pauseIcon: {
 fontSize: 22,
 color: '#0f2027',
 fontWeight: 'bold',
 },
});

export default PlayerControls;