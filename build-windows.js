#!/usr/bin/env node

// Clear code signing environment variables before building
delete process.env.WIN_CSC_LINK;
delete process.env.CSC_LINK;
delete process.env.CSC_KEY_PASSWORD;
delete process.env.WIN_CSC_KEY_PASSWORD;
delete process.env.APPLE_ID;
delete process.env.APPLE_APP_SPECIFIC_PASSWORD;
delete process.env.AC_PASSWORD;

// Remove winCodeSign cache that causes issues
const fs = require('fs');
const path = require('path');
const cacheDir = path.join(require('os').homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
if (fs.existsSync(cacheDir)) {
 const rm = require('child_process').execSync;
 try {
 rm(`rmdir /s /q "${cacheDir}" 2>nul`);
 } catch (e) {
 console.log('Cache cleanup skipped');
 }
}

const { execFileSync } = require('child_process');
const electronBuilderPath = path.join(__dirname, 'node_modules', '.bin', 'electron-builder.cmd');

try {
 execFileSync(electronBuilderPath, ['--win'], {
 stdio: 'inherit',
 env: {
 ...process.env,
 WIN_CSC_LINK: '',
 CSC_LINK: '',
 }
 });
} catch (error) {
 console.error('Build failed:', error.message);
 process.exit(1);
}