// Enhanced API configuration for VK Music, Yandex Music, and Spotify

export const VK_API_CONFIG = {
 CLIENT_ID: 'YOUR_VK_CLIENT_ID',
 CLIENT_SECRET: 'YOUR_VK_CLIENT_SECRET',
 REDIRECT_URI: 'YOUR_VK_REDIRECT_URI',
 API_URL: 'https://api.vk.com/method',
 VERSION: '5.131',
 SCOPES: 'audio'
};

export const YANDEX_API_CONFIG = {
 CLIENT_ID: 'YOUR_YANDEX_CLIENT_ID',
 CLIENT_SECRET: 'YOUR_YANDEX_CLIENT_SECRET',
 REDIRECT_URI: 'YOUR_YANDEX_REDIRECT_URI',
 API_URL: 'https://api.music.yandex.net'
};

export const SPOTIFY_API_CONFIG = {
 CLIENT_ID: 'YOUR_SPOTIFY_CLIENT_ID',
 CLIENT_SECRET: 'YOUR_SPOTIFY_CLIENT_SECRET',
 REDIRECT_URI: 'YOUR_SPOTIFY_REDIRECT_URI',
 API_URL: 'https://api.spotify.com/v1',
 SCOPES: 'playlist-read-private user-library-read user-read-email'
};

// Helper function to generate authorization URLs
export const getAuthUrls = () => {
 return {
 vk: `https://oauth.vk.com/authorize?client_id=${VK_API_CONFIG.CLIENT_ID}&scope=${VK_API_CONFIG.SCOPES}&redirect_uri=${VK_API_CONFIG.REDIRECT_URI}&response_type=token&v=${VK_API_CONFIG.VERSION}`,
 yandex: `https://oauth.yandex.ru/authorize?response_type=token&client_id=${YANDEX_API_CONFIG.CLIENT_ID}`,
 spotify: `https://accounts.spotify.com/authorize?client_id=${SPOTIFY_API_CONFIG.CLIENT_ID}&scope=${SPOTIFY_API_CONFIG.SCOPES.join('%20')}&redirect_uri=${encodeURIComponent(SPOTIFY_API_CONFIG.REDIRECT_URI)}&response_type=token`
 };
};