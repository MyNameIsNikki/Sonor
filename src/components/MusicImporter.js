// Music Importer Component with real service integration
import React, { useState } from 'react';
import { 
 View, 
 Text, 
 TouchableOpacity, 
 ActivityIndicator, 
 StyleSheet, 
 Alert,
 TextInput 
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { importVKMusic, importYandexMusic, importSpotify } from '../services/musicImport';

const MusicImporter = ({ onImportComplete }) => {
 const [importingService, setImportingService] = useState(null);
 const [showTokenInputs, setShowTokenInputs] = useState(false);
 const [tokens, setTokens] = useState({
 vk: '',
 yandex: '',
 spotify: ''
 });

 const handleImport = async (service) => {
 const serviceNames = {
 vk: 'VK Music',
 yandex: 'Яндекс Музыка',
 spotify: 'Spotify'
 };
 
 const token = tokens[service];
 if (!token) {
 Alert.alert(
 `Введите токен ${serviceNames[service]}`,
 'Пожалуйста, введите токен доступа для импорта'
 );
 setShowTokenInputs(true);
 return;
 }

 setImportingService(service);
 
 try {
 let tracks = [];
 
 switch (service) {
 case 'vk':
 tracks = await importVKMusic(token);
 break;
 case 'yandex':
 tracks = await importYandexMusic(token);
 break;
 case 'spotify':
 tracks = await importSpotify(token);
 break;
 }
 
 onImportComplete(tracks);
 } catch (error) {
 Alert.alert('Ошибка', `Не удалось импортировать из ${serviceNames[service]}`);
 } finally {
 setImportingService(null);
 }
 };

 return (
 <BlurView intensity={30} tint="light" style={styles.container}>
 <View style={styles.headerRow}>
 <Text style={styles.title}>Импорт музыки</Text>
 <TouchableOpacity onPress={() => setShowTokenInputs(!showTokenInputs)}>
 <Text style={styles.tokenToggle}>
 {showTokenInputs ? 'Скрыть' : 'Токены'}
 </Text>
 </TouchableOpacity>
 </View>
 
 {showTokenInputs && (
 <View style={styles.tokenInputs}>
 <TextInput
 style={styles.tokenInput}
 placeholder="VK Token"
 value={tokens.vk}
 onChangeText={(text) => setTokens({...tokens, vk: text})}
 secureTextEntry
 />
 <TextInput
 style={styles.tokenInput}
 placeholder="Yandex Token"
 value={tokens.yandex}
 onChangeText={(text) => setTokens({...tokens, yandex: text})}
 secureTextEntry
 />
 <TextInput
 style={styles.tokenInput}
 placeholder="Spotify Token"
 value={tokens.spotify}
 onChangeText={(text) => setTokens({...tokens, spotify: text})}
 secureTextEntry
 />
 </View>
 )}
 
 <View style={styles.servicesContainer}>
 <TouchableOpacity
 style={[styles.serviceBtn, importingService === 'vk' && styles.importing]}
 onPress={() => handleImport('vk')}
 disabled={!!importingService}
 >
 {importingService === 'vk' ? (
 <ActivityIndicator color="#fff" size="small" />
 ) : (
 <LinearGradient colors={['#4facfe', '#00f2fe']} style={styles.gradient}>
 <Text style={styles.serviceText}>VK Music</Text>
 </LinearGradient>
 )}
 </TouchableOpacity>
 
 <TouchableOpacity
 style={[styles.serviceBtn, importingService === 'yandex' && styles.importing]}
 onPress={() => handleImport('yandex')}
 disabled={!!importingService}
 >
 {importingService === 'yandex' ? (
 <ActivityIndicator color="#fff" size="small" />
 ) : (
 <LinearGradient colors={['#00b4d8', '#0077b6']} style={styles.gradient}>
 <Text style={styles.serviceText}>Яндекс Музыка</Text>
 </LinearGradient>
 )}
 </TouchableOpacity>
 
 <TouchableOpacity
 style={[styles.serviceBtn, importingService === 'spotify' && styles.importing]}
 onPress={() => handleImport('spotify')}
 disabled={!!importingService}
 >
 {importingService === 'spotify' ? (
 <ActivityIndicator color="#fff" size="small" />
 ) : (
 <LinearGradient colors={['#1db954', '#1ed760']} style={styles.gradient}>
 <Text style={styles.serviceText}>Spotify</Text>
 </LinearGradient>
 )}
 </TouchableOpacity>
 </View>
 </BlurView>
 );
};

const styles = StyleSheet.create({
 container: {
 margin: 20,
 padding: 20,
 borderRadius: 15,
 backgroundColor: 'rgba(15, 32, 39, 0.7)',
 borderWidth: 1,
 borderColor: 'rgba(0, 212, 255, 0.3)',
 },
 headerRow: {
 flexDirection: 'row',
 justifyContent: 'space-between',
 alignItems: 'center',
 marginBottom: 15,
 },
 title: {
 fontSize: 18,
 fontWeight: 'bold',
 color: '#00d4ff',
 },
 tokenToggle: {
 color: '#a0c4d8',
 fontSize: 13,
 textDecorationLine: 'underline',
 },
 tokenInputs: {
 gap: 10,
 marginBottom: 15,
 },
 tokenInput: {
 backgroundColor: 'rgba(0, 0, 0, 0.2)',
 borderRadius: 8,
 padding: 10,
 color: '#fff',
 fontSize: 13,
 },
 servicesContainer: {
 gap: 12,
 },
 serviceBtn: {
 borderRadius: 10,
 overflow: 'hidden',
 elevation: 5,
 },
 importing: {
 opacity: 0.7,
 },
 gradient: {
 padding: 15,
 alignItems: 'center',
 borderRadius: 10,
 },
 serviceText: {
 color: '#fff',
 fontSize: 16,
 fontWeight: 'bold',
 },
});

export default MusicImporter;