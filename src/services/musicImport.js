// Enhanced Music Import Service for VK Music, Yandex Music, and Spotify
import * as MediaLibrary from 'expo-media-library';

// VK Music API integration
export const importVKMusic = async (token) => {
 try {
 const response = await fetch(
 `https://api.vk.com/method/audio.get?access_token=${token}&v=5.131&count=100`
 );
 const data = await response.json();
 
 if (data.error) {
 throw new Error(data.error.error_message || 'VK API Error');
 }
 
 return data.response.items.map((item) => ({
 id: `vk_${item.id}`,
 title: item.title || 'Без названия',
 artist: item.artist || 'Неизвестно',
 duration: item.duration * 1000, // Convert to milliseconds
 url: item.url,
 source: 'vk'
 }));
 } catch (error) {
 console.error('VK Music import error:', error);
 throw error;
 }
};

// Yandex Music API integration
export const importYandexMusic = async (token) => {
 try {
 // Get user playlists
 const playlistResponse = await fetch(
 'https://api.music.yandex.net/users/me/playlists',
 {
 headers: {
 Authorization: `OAuth ${token}`
 }
 }
 );
 
 const playlistData = await playlistResponse.json();
 let allTracks = [];
 
 // Get tracks from each playlist
 for (const playlist of playlistData.playlists) {
 const tracksResponse = await fetch(
 `https://api.music.yandex.net/users/me/playlists/${playlist.kind}/tracks`,
 {
 headers: {
 Authorization: `OAuth ${token}`
 }
 }
 );
 
 const tracksData = await tracksResponse.json();
 
 if (tracksData.tracks) {
 const playlistTracks = tracksData.tracks.map((item) => {
 const track = item.track || item;
 return {
 id: `yandex_${track.id}_${item.id || Math.random()}`,
 title: track.title || track.name || 'Без названия',
 artist: track.artists?.[0]?.name || 'Неизвестно',
 duration: (track.durationMs || track.duration * 1000 || 0),
 url: track.preview || null,
 source: 'yandex'
 };
 });
 
 allTracks.push(...playlistTracks);
 }
 }
 
 return allTracks;
 } catch (error) {
 console.error('Yandex Music import error:', error);
 throw error;
 }
};

// Spotify API integration
export const importSpotify = async (token) => {
 try {
 let allTracks = [];
 let nextUrl = 'https://api.spotify.com/v1/me/playlists?limit=50';
 
 while (nextUrl) {
 const response = await fetch(nextUrl, {
 headers: {
 Authorization: `Bearer ${token}`
 }
 });
 
 const data = await response.json();
 
 for (const playlist of data.items) {
 const tracksResponse = await fetch(
 `https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=100`,
 {
 headers: {
 Authorization: `Bearer ${token}`
 }
 }
 );
 
 const tracksData = await tracksResponse.json();
 
 if (tracksData.items) {
 const playlistTracks = tracksData.items
 .filter((item) => item.track)
 .map((item) => ({
 id: `spotify_${item.track.id}_${item.disc_number || ''}`,
 title: item.track.name || 'Без названия',
 artist: item.track.artists?.[0]?.name || 'Неизвестно',
 album: item.track.album?.name || '',
 duration: item.track.duration_ms || 0,
 url: item.track.preview_url || null,
 image: item.track.album?.images?.[0]?.url || null,
 source: 'spotify'
 }));
 
 allTracks.push(...playlistTracks);
 }
 }
 
 nextUrl = data.next;
 }
 
 return allTracks;
 } catch (error) {
 console.error('Spotify import error:', error);
 throw error;
 }
};

// Helper function to save tracks locally
export const saveTracksLocally = async (tracks) => {
 try {
 const permission = await MediaLibrary.requestPermissionsAsync();
 if (!permission.granted) {
 throw new Error('Media library permission denied');
 }
 
 // In a real app, you would download and save the actual audio files
 // For demo purposes, we'll just return the tracks with local URIs
 return tracks;
 } catch (error) {
 console.error('Error saving tracks:', error);
 throw error;
 }
};