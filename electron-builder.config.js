/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.sonor.music',
  productName: 'Sonor Music Player',
  copyright: 'Copyright © 2026 ANV',
  directories: {
    output: 'release',
    buildResources: 'build'
  },
  files: [
    '!**/*',
    'electron-main.js',
    'preload.js',
    'main.js',
    'index.html',
    'package.json',
    'App.js',
    'src/**/*',
    'icon.png',
    // Продакш-зависимости главного процесса (electron-updater, music-metadata
    // и их транзитивные модули). Dev-зависимости (expo, react-native) не
    // попадают: electron-builder кладёт в пакет только дерево dependencies.
    'node_modules/**/*'
  ],
  extraMetadata: {
    main: 'electron-main.js'
  },
  // Автообновление через GitHub Releases (electron-updater читает latest.yml)
  publish: {
    provider: 'github',
    owner: 'MyNameIsNikki',
    repo: 'Sonor'
  },
  // Never require code signing for local builds
  forceCodeSigning: false,
  win: {
    target: ['nsis', 'zip'],
    icon: 'build/icon.ico',
    publisherName: 'ANV',
    signAndEditExecutable: false
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Sonor',
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    artifactName: 'Sonor-Setup-${version}.${ext}'
  }
};
