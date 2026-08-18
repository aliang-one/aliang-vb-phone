#!/usr/bin/env node
/**
 * One-command signed release APK build: `npm run android:release`.
 *
 * Signing credentials are read by Gradle from ~/.gradle/gradle.properties
 * (or env) — the 4 ALIANG_RELEASE_* values. They are deliberately NOT in the
 * repo (android/gradle.properties is tracked; secrets live in ~/.gradle which
 * is outside any git repo). We pre-check them here for a fast, clear error
 * before invoking the (slow) Gradle build.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const androidDir = path.join(projectRoot, 'android');
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const apkPath = path.join(
  androidDir,
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk',
);

const REQUIRED_KEYS = [
  'ALIANG_RELEASE_STORE_FILE',
  'ALIANG_RELEASE_STORE_PASSWORD',
  'ALIANG_RELEASE_KEY_ALIAS',
  'ALIANG_RELEASE_KEY_PASSWORD',
];

// Parse ~/.gradle/gradle.properties (key=value) so we can pre-check presence
// without exposing the secret values themselves.
const gradlePropsPath = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.gradle',
  'gradle.properties',
);
const gradleProps = {};
if (fs.existsSync(gradlePropsPath)) {
  for (const line of fs.readFileSync(gradlePropsPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
    if (match) gradleProps[match[1]] = match[2].trim();
  }
}

const missing = REQUIRED_KEYS.filter(key => !gradleProps[key] && !process.env[key]);
// The advertised internal-testing escape hatch. Gradle checks the same value
// (prop or env) in build.gradle — mirror it here so the pre-check doesn't
// block the debug-signed path it points to.
const allowDebugSigning =
  process.env.ALLOW_DEBUG_RELEASE_SIGNING === 'true' ||
  gradleProps.ALLOW_DEBUG_RELEASE_SIGNING === 'true';
if (missing.length > 0 && !allowDebugSigning) {
  console.error('❌ Release signing is not configured. Missing: ' + missing.join(', '));
  console.error('   Set all four in ~/.gradle/gradle.properties (NOT in the repo):');
  REQUIRED_KEYS.forEach(key => console.error(`     ${key}=...`));
  console.error('   For an internal-only test APK instead, set ALLOW_DEBUG_RELEASE_SIGNING=true.');
  process.exit(1);
}
if (missing.length > 0) {
  console.warn('⚠️  ALLOW_DEBUG_RELEASE_SIGNING=true — building a debug-signed internal APK.');
  console.warn('   Do not distribute this artifact as a production update.');
}

// ABI filter: default arm64-v8a (mainstream devices, smallest APK). Variants
// pass a comma-separated list, e.g. "arm64-v8a,armeabi-v7a,x86_64,x86" for full.
// build.gradle's release block reads ALIANG_ABI_FILTERS (prop or env).
const abiFilter = process.argv[2] || 'arm64-v8a';
process.env.ALIANG_ABI_FILTERS = abiFilter;

console.log(`▶ Building signed release APK (assembleRelease) — ABIs: ${abiFilter}`);
console.log('   This can take a few minutes.\n');

const result = spawnSync(
  gradlew,
  ['assembleRelease', `-PALIANG_ABI_FILTERS=${abiFilter}`],
  {
    cwd: androidDir,
    stdio: 'inherit',
    env: process.env,
  },
);

if (result.status !== 0) {
  console.error('\n❌ Release build failed (gradle exit ' + result.status + ').');
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(apkPath)) {
  console.error('\n⚠️  Build reported success but the APK was not found at:\n   ' + apkPath);
  process.exit(1);
}

const sizeMb = (fs.statSync(apkPath).size / (1024 * 1024)).toFixed(1);
console.log(`\n✅ Release APK built (${sizeMb} MB):`);
console.log(`   ${apkPath}`);
console.log('   Install with:  adb install -r "' + apkPath + '"');
