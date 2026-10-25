/*
 * Compatibility patches for building Expo SDK 49 native Android modules
 * with Gradle 8 / AGP 7.4:
 *   1. Gradle 8 renamed Jar.classifier to archiveClassifier.
 *   2. Some Expo modules rely on safeExtGet() for compileSdkVersion, which is
 *      not resolved when the module is configured from a workspace root.
 * Run from the project root: node scripts/patch-android-gradle.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

function findAndroidBuildFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }

  for (const entry of entries) {
    if (entry.name === '.bin' || entry.name === '.cache') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findAndroidBuildFiles(full, out);
    } else if (
      entry.name === 'build.gradle' &&
      path.basename(path.dirname(full)) === 'android'
    ) {
      out.push(full);
    }
  }
  return out;
}

const files = findAndroidBuildFiles(path.join(ROOT, 'node_modules'), []);
let patched = 0;

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before
    .replace(/classifier\s*=\s*['"]sources['"]/g, "archiveClassifier = 'sources'")
    .replace(
      /compileSdkVersion\s+safeExtGet\(\s*['"]compileSdkVersion['"]\s*,[^)]*\)/g,
      'compileSdkVersion 33'
    );
  if (after !== before) {
    fs.writeFileSync(file, after);
    patched += 1;
    console.log('patched', path.relative(ROOT, file));
  }
}

console.log('Patched files:', patched, 'of', files.length, 'Android build.gradle files');
