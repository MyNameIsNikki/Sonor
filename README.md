# Sonor — музыкальный плеер

Красивый музыкальный плеер в сине-голубой неоновой теме: десктоп-приложение для Windows и мобильное приложение на Expo (Android / iOS). Поддерживает локальные аудиофайлы и импорт плейлистов из **VK Музыки**, **Яндекс Музыки** и **Spotify**.

![Sonor](icon.png)

## Возможности

- 🎧 Воспроизведение локальных файлов: MP3, FLAC, WAV, M4A, OGG
- 💙 Премиальный дизайн: glassmorphism, градиенты, неоновый циан `#00d4ff`
- 📥 Импорт треков из VK Музыки, Яндекс Музыки и Spotify по токену
- 🔎 Поиск по названию и исполнителю
- ▶️ Полный плеер: play/pause, следующий/предыдущий, перемотка, громкость, автопереход
- 🖱️ Drag & drop файлов в окно приложения
- 📱 Адаптивный мобильный интерфейс (Expo, React Native)
- 🪟 Установщик Windows (NSIS) + портативный ZIP
- 🤖 Сборка Android APK через GitHub Actions

## Скачать

Готовые файлы для Windows и Android: **[github.com/MyNameIsNikki/Sonor/releases/latest](https://github.com/MyNameIsNikki/Sonor/releases/latest)**

## Готовые сборки

| Платформа | Файл | Где взять |
|---|---|---|
| Windows (установщик) | `Sonor-Setup-1.0.0.exe` | [GitHub Releases](https://github.com/MyNameIsNikki/Sonor/releases/latest) или папка `release/` после сборки |
| Windows (портативная) | `Sonor Music Player-1.0.0-win.zip` | [GitHub Releases](https://github.com/MyNameIsNikki/Sonor/releases/latest) или папка `release/` |
| Android (APK) | `Sonor-1.0.0.apk` | [GitHub Releases](https://github.com/MyNameIsNikki/Sonor/releases/latest) или артефакт workflow **Build Android APK** |
| iOS | `.ipa` | только через EAS Build (нужен Apple Developer) |

> Для телефонов собирается **APK** (Android) — формат установочного файла для мобильных. `.exe` — это формат Windows, на телефоне он не запускается.

### GitHub Actions

- **Build Android APK** — `Actions → Build Android APK → Run workflow`. Готовый APK появится в артефактах workflow (`sonor-apk`).
- **Build Windows Installer** — `Actions → Build Windows Installer → Run workflow`. Установщик и ZIP появятся в артефактах (`sonor-windows-setup`).

## Быстрый старт

```bash
npm install --legacy-peer-deps
npm start              # Expo dev server (телефон / веб)
npm run start:desktop  # Electron-приложение на компьютере
```

Требуется Node.js 18+ (проверено на Node 24).

## Сборка

### Windows

```bash
npm run build:windows
```

Результат:

- `release/Sonor-Setup-1.0.0.exe` — установщик с выбором папки, ярлыками на рабочем столе и в меню «Пуск»
- `release/Sonor Music Player-1.0.0-win.zip` — портативная версия
- `release/win-unpacked/` — распакованное приложение

Сборка не подписывается сертификатом (в конфиге `signAndEditExecutable: false`), поэтому Windows SmartScreen может показать предупреждение «Неизвестный издатель» — это нормально для неподписанных сборок.

### Android

Вариант 1 — GitHub Actions (рекомендуется, Android SDK не нужен локально):

```
Actions → Build Android APK → Run workflow
```

Вариант 2 — локально (нужен Android SDK + JDK 17):

```bash
npx expo prebuild --platform android --clean
cd android
./gradlew assembleRelease
```

APK: `android/app/build/outputs/apk/release/app-release.apk`.

Вариант 3 — EAS Build:

```bash
npm run build:android
```

## Настройка импорта

Импорт работает по токенам доступа. Токены вводятся на вкладке «Импорт музыки» и никуда не сохраняются.

### VK Музыка

1. Откройте [vk.com/editapp](https://vk.com/editapp) и создайте Standalone-приложение.
2. Получите access token с правами `audio`.
3. Вставьте токен в поле VK.

> VK ограничивает `audio.get` для сторонних приложений — если API вернёт ошибку доступа, используйте официальный токен приложения VK.

### Яндекс Музыка

1. Зарегистрируйте приложение на [oauth.yandex.ru](https://oauth.yandex.ru/).
2. Получите OAuth-токен с доступом к музыке.
3. Вставьте токен в поле Яндекс.

Импортируются все плейлисты пользователя. Часть треков может быть без прямой ссылки — такие треки отображаются, но воспроизведение доступно только при наличии `preview`.

### Spotify

1. Создайте приложение на [developer.spotify.com](https://developer.spotify.com/dashboard).
2. Получите access token (scopes: `playlist-read-private`, `user-library-read`).
3. Вставьте токен в поле Spotify.

Spotify отдаёт только 30-секундные `preview_url` для части треков; полноценное воспроизведение требует Spotify Premium и SDK, поэтому в Sonor импортируются метаданные и превью.

## Структура проекта

```
Музыкальный плеер/
├── App.js                      # Мобильное приложение (Expo)
├── index.html                  # Интерфейс десктоп-приложения
├── electron-main.js            # Electron main: окно + импорт через HTTPS
├── main.js                     # Ранний Electron entry
├── electron-builder.config.js  # Конфигурация сборки Windows
├── package.json
├── app.json                    # Конфигурация Expo
├── eas.json                    # Профили EAS Build
├── babel.config.js
├── icon.png / splash.png       # Иконка и заставка
├── build/
│   ├── icon.ico                # Иконка Windows (16–256 px)
│   └── icon.png
├── src/
│   ├── components/
│   │   ├── MusicImporter.js    # UI импорта на мобильном
│   │   ├── PlayerControls.js
│   │   └── TrackList.js
│   ├── config/apiConfig.js
│   └── services/musicImport.js # Импорт для мобильного приложения
├── android/                    # Нативная Android-обвязка
├── ios/                        # Нативная iOS-обвязка
└── .github/workflows/
    ├── build-apk.yml           # CI сборки APK
    └── build-windows.yml       # CI сборки установщика
```

## Дизайн

- Основной акцент: `#00d4ff` (циан)
- Второй акцент: `#4facfe` (голубой)
- Фон: `#0f2027 → #203345 → #2c5364`
- Стеклянные панели, мягкие тени, градиентные кнопки
- Тёмная тема, оптимизированная под OLED

## Решение проблем

- **`npm install` падает с peer dependency** — используйте `npm install --legacy-peer-deps`.
- **Windows SmartScreen** — установщик не подписан, нажмите «Подробнее → Выполнить в любом случае».
- **Пустое окно Electron** — запустите `npm run start:desktop`; в dev-режиме приложение ждёт Expo на `localhost:19006`.
- **Импорт не работает** — проверьте срок жизни токена и необходимые scopes.
- **Трек не играет** — у трека может не быть прямой ссылки (особенно Spotify/VK); добавьте локальный файл.

## Лицензия

MIT © Sonor Music

---

Сделано с ❤️ на React Native, Expo и Electron.
GitHub: https://github.com/MyNameIsNikki/Sonor
