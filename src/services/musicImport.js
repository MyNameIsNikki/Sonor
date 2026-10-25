// Music import service for VK Music, Yandex Music, and Spotify
import * as MediaLibrary from 'expo-media-library';

const MAX_TRACKS = 300;

// VK Music API integration
export const importVKMusic = async (token) => {
  try {
    const response = await fetch(
      `https://api.vk.com/method/audio.get?access_token=${encodeURIComponent(token)}&v=5.131&count=200`
    );
    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.error_msg || data.error.error_message || 'VK API Error');
    }

    const items = Array.isArray(data.response) ? data.response : (data.response?.items || []);

    return items.slice(0, MAX_TRACKS).map((item) => ({
      id: `vk_${item.id}`,
      title: item.title || 'Без названия',
      artist: item.artist || 'Неизвестно',
      album: '',
      duration: (item.duration || 0) * 1000,
      url: item.url || null,
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
    const headers = { Authorization: `OAuth ${token}` };
    const playlistResponse = await fetch(
      'https://api.music.yandex.net/users/me/playlists',
      { headers }
    );

    const playlistData = await playlistResponse.json();
    const playlists =
      playlistData?.result?.playlists ||
      playlistData?.playlists ||
      (Array.isArray(playlistData?.result) ? playlistData.result : []);

    if (!playlists.length) {
      throw new Error('Плейлисты не найдены. Проверьте токен Яндекс Музыки.');
    }

    const allTracks = [];

    for (const playlist of playlists) {
      if (allTracks.length >= MAX_TRACKS) break;
      if (playlist.kind === undefined || playlist.kind === null) continue;

      try {
        const tracksResponse = await fetch(
          `https://api.music.yandex.net/users/me/playlists/${playlist.kind}/tracks`,
          { headers }
        );
        const tracksData = await tracksResponse.json();
        const raw =
          tracksData?.result?.tracks ||
          tracksData?.tracks ||
          (Array.isArray(tracksData?.result) ? tracksData.result : []);

        for (const entry of raw) {
          if (allTracks.length >= MAX_TRACKS) break;
          const track = entry.track || entry;
          if (!track) continue;
          allTracks.push({
            id: `yandex_${track.id || Math.random().toString(36).slice(2)}`,
            title: track.title || track.name || 'Без названия',
            artist: Array.isArray(track.artists)
              ? track.artists.map((a) => a.name).filter(Boolean).join(', ')
              : 'Неизвестно',
            album: track.albums?.[0]?.title || '',
            duration: track.durationMs || (track.duration || 0) * 1000,
            url: track.preview || null,
            source: 'yandex'
          });
        }
      } catch (error) {
        // Ignore a single broken playlist and continue with the rest
      }
    }

    if (!allTracks.length) {
      throw new Error('Не удалось получить треки Яндекс Музыки.');
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
    const headers = { Authorization: `Bearer ${token}` };
    const allTracks = [];
    let nextUrl = 'https://api.spotify.com/v1/me/playlists?limit=50';
    let pages = 0;

    while (nextUrl && allTracks.length < MAX_TRACKS && pages < 10) {
      pages++;
      const response = await fetch(nextUrl, { headers });
      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || 'Spotify API Error');
      }

      for (const playlist of data.items || []) {
        if (allTracks.length >= MAX_TRACKS) break;
        if (!playlist?.id) continue;

        try {
          const tracksResponse = await fetch(
            `https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=100`,
            { headers }
          );
          const tracksData = await tracksResponse.json();

          for (const item of tracksData.items || []) {
            if (allTracks.length >= MAX_TRACKS) break;
            const track = item?.track;
            if (!track?.id) continue;
            allTracks.push({
              id: `spotify_${track.id}_${allTracks.length}`,
              title: track.name || 'Без названия',
              artist: (track.artists || []).map((a) => a.name).join(', ') || 'Неизвестно',
              album: track.album?.name || '',
              duration: track.duration_ms || 0,
              url: track.preview_url || null,
              image: track.album?.images?.[0]?.url || null,
              source: 'spotify'
            });
          }
        } catch (error) {
          // Ignore a single broken playlist
        }
      }

      nextUrl = data.next || null;
    }

    if (!allTracks.length) {
      throw new Error('Не удалось получить треки Spotify.');
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
