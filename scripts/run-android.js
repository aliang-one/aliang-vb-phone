#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const metroPort = Number(process.env.RCT_METRO_PORT || 8081);
const platformPort = Number(process.env.ALIANG_PLATFORM_PORT || 4000);
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const adbBin = process.env.ADB || 'adb';

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
  console.log(`[android] Metro started in background on :${metroPort}`);
  console.log(`[android] Metro log: ${logFile}`);
}

function adbReverse(port) {
  try {
    execFileSync(adbBin, ['reverse', `tcp:${port}`, `tcp:${port}`], {
      cwd: projectRoot,
      stdio: 'pipe',
    });
    console.log(`[android] adb reverse tcp:${port} -> tcp:${port}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[android] adb reverse for tcp:${port} skipped: ${detail}`);
  }
}

async function main() {
  const metroReady = await isPortOpen(metroPort);
  if (metroReady) {
    console.log(`[android] Metro already listening on :${metroPort}`);
  } else {
    startMetro();
    const started = await waitForPort(metroPort, 30000);
    if (!started) {
      console.error(`[android] Metro did not become ready on :${metroPort}`);
      console.error('[android] Check .metro/metro.log for details.');
      process.exit(1);
    }
  }

  adbReverse(metroPort);
  adbReverse(platformPort);

  const args = [
    'react-native',
    'run-android',
    '--no-packager',
    '--port',
    String(metroPort),
    ...process.argv.slice(2),
  ];
  const result = spawnSync(npxBin, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      RCT_METRO_PORT: String(metroPort),
    },
  });

  process.exit(result.status ?? 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
