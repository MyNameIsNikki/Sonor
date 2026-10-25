# Sonor - Музыкальный плеер (Music Player)

An enhanced mobile music player with a stunning blue-themed design that supports importing music from VK Music, Yandex Music, and Spotify.

## Features
- 💙 Beautiful blue-themed gradient interface
- 🎵 Import music from VK Music, Yandex Music, and Spotify
- 📱 Cross-platform mobile app (iOS & Android) using Expo
- 🎧 Audio playback with full controls
- 📱 Responsive layout optimized for mobile devices
- 🎨 Glass-morphism UI effects
- 📋 Track listing with playback controls
- 🔐 Secure token-based authentication

## Setup Instructions

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Expo CLI

### Installation

1. Install Expo CLI globally:
   ```bash
   npm install -g expo-cli
   ```

2. Install dependencies:
   ```bash
   cd "Музыкальный плеер"
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

4. Run on a device:
   ```bash
   npm run android
   # or
   npm run ios
   # or for web:
   npm run web
   ```

## Configuration

To enable music imports, you need to obtain API tokens:

### VK Music
1. Go to [vk.com/editapp](https://vk.com/editapp)
2. Create a new application
3. Set the redirect URI
4. Get your client ID and token
5. Configure in `src/config/apiConfig.js`

### Yandex Music
1. Go to [Yandex OAuth](https://oauth.yandex.ru/)
2. Register a new application
3. Get your client ID and OAuth token
4. Configure in `src/config/apiConfig.js`

### Spotify
1. Go to [Spotify Developer](https://developer.spotify.com/)
2. Create a new application
3. Set redirect URI (e.g., `http://localhost:19003`)
4. Get your client ID and token
5. Configure in `src/config/apiConfig.js`

## Usage

1. **Import Music**: Click the "📥 Импорт музыки" button and enter your API tokens
2. **Play Music**: Tap on any track in the list to start playing
3. **Control Playback**: Use the play/pause and skip buttons in the player controls
4. **Toggle Import**: Show/hide the import section as needed

## Project Structure

```
Музыкальный плеер/
├── App.js                 # Main application entry point
├── package.json           # Project dependencies and scripts
├── README.md              # Project documentation
└── src/
    ├── components/
    │   ├── MusicImporter.js    # Import component for VK/Yandex/Spotify
    │   ├── PlayerControls.js   # Audio player controls
    │   └── TrackList.js        # Track listing component
    ├── config/
    │   └── apiConfig.js        # API configurations
    └── services/
        └── musicImport.js      # Music import service logic
```

## Design Guidelines

The player features a modern blue-themed design:
- Primary color: `#00d4ff` (Cyan blue)
- Secondary colors: Deep blue gradients
- Background: Dark blue gradient (`#0f2027` → `#203345` → `#2c5364`)
- Glass-morphism effects with blur overlays
- Smooth animations and transitions

## Troubleshooting

- **Import fails**: Check your API tokens and permissions
- **Audio not playing**: Ensure device volume is up and headphones are connected
- **App crashes**: Clear the Expo cache: `expo start -c`

## License

MIT License - see package.json for details

---
Made with ❤️ using React Native and Expo