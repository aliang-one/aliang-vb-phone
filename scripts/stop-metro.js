#!/usr/bin/env node

const { execFileSync } = require('child_process');

const metroPort = Number(process.env.RCT_METRO_PORT || 8081);

function findPids() {
  try {
    const output = execFileSync('lsof', ['-ti', `tcp:${metroPort}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split(/\s+/)
      .map(value => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const pids = findPids();

if (pids.length === 0) {
  console.log(`[metro] No process is listening on :${metroPort}`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    process.kill(Number(pid), 'SIGTERM');
    console.log(`[metro] Stopped process ${pid} on :${metroPort}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[metro] Failed to stop process ${pid}: ${detail}`);
  }
}
