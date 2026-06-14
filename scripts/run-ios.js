#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const iosDir = path.join(projectRoot, 'ios');
const metroPort = Number(process.env.RCT_METRO_PORT || 8081);
const configuration = process.env.CONFIGURATION || process.env.RN_IOS_CONFIGURATION || 'Debug';
const scheme = process.env.RN_IOS_SCHEME || 'AliangVibeCodingPhone';
const workspace = path.join(iosDir, 'AliangVibeCodingPhone.xcworkspace');
const derivedDataPath =
  process.env.RN_IOS_DERIVED_DATA || path.join(iosDir, 'build', 'DerivedData');
const destination =
  process.env.RN_IOS_DESTINATION || 'generic/platform=iOS Simulator';
const buildSettings = [
  ...(process.env.RN_IOS_ARCHS ? [`ARCHS=${process.env.RN_IOS_ARCHS}`] : []),
  ...(process.env.RN_IOS_EXCLUDED_ARCHS !== undefined
    ? [`EXCLUDED_ARCHS=${process.env.RN_IOS_EXCLUDED_ARCHS}`]
    : []),
  ...(process.env.RN_IOS_ONLY_ACTIVE_ARCH
    ? [`ONLY_ACTIVE_ARCH=${process.env.RN_IOS_ONLY_ACTIVE_ARCH}`]
    : []),
];
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function isPortOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = result => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(750);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForPort(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

function startMetro() {
  const logDir = path.join(projectRoot, '.metro');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'metro.log');
  const out = fs.openSync(logFile, 'a');

  const child = spawn(
    npxBin,
    ['react-native', 'start', '--port', String(metroPort)],
    {
      cwd: projectRoot,
      detached: true,
      stdio: ['ignore', out, out],
      env: {
        ...process.env,
        RCT_METRO_PORT: String(metroPort),
      },
    },
  );

  child.unref();
  console.log(`[ios] Metro started in background on :${metroPort}`);
  console.log(`[ios] Metro log: ${logFile}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      RCT_METRO_PORT: String(metroPort),
    },
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function output(command, args) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseJson(command, args) {
  return JSON.parse(output(command, args));
}

function listAvailableSimulators() {
  const list = parseJson('xcrun', ['simctl', 'list', 'devices', 'available', '-j']);
  return Object.entries(list.devices || {})
    .filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([, devices]) => devices)
    .filter(device => device.isAvailable !== false);
}

function listBootedSimulators() {
  const list = parseJson('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']);
  return Object.entries(list.devices || {})
    .filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([, devices]) => devices)
    .filter(device => device.state === 'Booted' && device.isAvailable !== false);
}

function selectSimulator() {
  const requestedUdid = process.env.RN_IOS_UDID;
  if (requestedUdid) {
    return { udid: requestedUdid, name: requestedUdid };
  }

  const booted = listBootedSimulators();
  if (booted.length > 0) {
    return booted[0];
  }

  const preferredName = process.env.RN_IOS_SIMULATOR || 'iPhone 17 Pro';
  const available = listAvailableSimulators();
  const preferred = available.find(device => device.name === preferredName);
  const fallback =
    preferred ||
    available.find(device => device.name && device.name.startsWith('iPhone')) ||
    available[0];

  if (!fallback) {
    throw new Error('[ios] No available iOS simulator was found.');
  }

  console.log(`[ios] Booting simulator: ${fallback.name} (${fallback.udid})`);
  run('xcrun', ['simctl', 'boot', fallback.udid]);
  run('open', ['-a', 'Simulator']);
  return fallback;
}

function appPath() {
  return path.join(
    derivedDataPath,
    'Build',
    'Products',
    `${configuration}-iphonesimulator`,
    `${scheme}.app`,
  );
}

function readBundleIdentifier(builtAppPath) {
  try {
    return output('/usr/libexec/PlistBuddy', [
      '-c',
      'Print:CFBundleIdentifier',
      path.join(builtAppPath, 'Info.plist'),
    ]).trim();
  } catch {
    return 'org.reactjs.native.example.AliangVibeCodingPhone';
  }
}

async function main() {
  const metroReady = await isPortOpen(metroPort);
  if (metroReady) {
    console.log(`[ios] Metro already listening on :${metroPort}`);
  } else {
    startMetro();
    const started = await waitForPort(metroPort, 30000);
    if (!started) {
      console.error(`[ios] Metro did not become ready on :${metroPort}`);
      console.error('[ios] Check .metro/metro.log for details.');
      process.exit(1);
    }
  }

  const simulator = selectSimulator();
  const xcodeArgs = [
    '-workspace',
    workspace,
    '-configuration',
    configuration,
    '-scheme',
    scheme,
    '-destination',
    destination,
    '-derivedDataPath',
    derivedDataPath,
    ...buildSettings,
    'build',
    ...process.argv.slice(2),
  ];

  console.log(`[ios] Building ${scheme} (${configuration}) for ${destination}`);
  run('xcodebuild', xcodeArgs);

  const builtAppPath = appPath();
  if (!fs.existsSync(builtAppPath)) {
    console.error(`[ios] Built app was not found: ${builtAppPath}`);
    process.exit(1);
  }

  const bundleIdentifier = readBundleIdentifier(builtAppPath);
  console.log(`[ios] Installing ${bundleIdentifier} on ${simulator.name}`);
  spawnSync('xcrun', ['simctl', 'uninstall', simulator.udid, bundleIdentifier], {
    cwd: projectRoot,
    stdio: 'ignore',
  });
  run('xcrun', ['simctl', 'install', simulator.udid, builtAppPath]);

  console.log(`[ios] Launching ${bundleIdentifier}`);
  run('xcrun', ['simctl', 'launch', simulator.udid, bundleIdentifier]);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
