// Self-healing dependency bootstrap.
//
// Installs the project's npm dependencies when they are missing, then
// downloads the correct ffmpeg binary for the CURRENT platform when it is
// missing. This matters because zipped `node_modules` folders are often
// moved between Windows and Linux (or uploaded to a VPS), leaving binaries
// for the wrong OS behind — @discordjs/voice then fails to decode audio.
//
// Invoked from:
//   - package.json `postinstall` / `prestart` (CLI entry)
//   - run.js             via  .main()        before spawning the bot
//
// Set SKIP_BOOTSTRAP=1 to skip entirely (offline development).

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FFMPEG_STATIC_DIR = path.join(ROOT, 'node_modules', 'ffmpeg-static');

let lastError = null;

// Ensures the project's own npm dependencies are installed. The release zips
// ship WITHOUT node_modules, and hosting panels often run `node run.js` (or
// `npm start`) directly, so without this the bot would crash-loop on
// `Cannot find module 'discord.js'` / 'dotenv'. Runs a full `npm install` the
// first time, then skips once discord.js is present.
function ensureNodeModules() {
  if (process.env.SKIP_BOOTSTRAP === '1') return { name: 'node_modules', skipped: true };
  // Guard against recursion: our own `npm install` triggers the package's
  // `postinstall`, which re-runs this file in a child process.
  if (process.env.BISCORD_BOOTSTRAP === '1') return { name: 'node_modules', skipped: true };

  const markers = [
    path.join(ROOT, 'node_modules', 'discord.js', 'package.json'),
    path.join(ROOT, 'node_modules', 'dotenv', 'package.json'),
  ];
  if (markers.every((m) => fs.existsSync(m))) return { name: 'node_modules', skipped: true };

  console.log('[ensure-deps] Dependencies not installed — running `npm install` (this can take a few minutes)...');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(`${npmCmd} install --no-audit --no-fund`, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    timeout: 900_000,
    env: { ...process.env, BISCORD_BOOTSTRAP: '1' },
  });

  if (res.error) {
    throw new Error(
      `could not run npm install (${res.error.message}). Install Node.js >=18.17.0 (npm is included), ` +
      'then run `npm install` manually in this folder.',
    );
  }
  if (res.status !== 0 && !fs.existsSync(markers[0])) {
    throw new Error(
      `npm install failed (exit ${res.status}). Install Node.js >=18.17.0 and run \`npm install\` ` +
      'manually to see the full error.',
    );
  }
  if (!fs.existsSync(markers[0])) {
    throw new Error('npm install finished but discord.js is still missing — run `npm install` manually.');
  }
  if (res.status !== 0) {
    // e.g. only the ffmpeg binary step in `postinstall` failed — the
    // packages themselves are fine, and ensureFfmpeg below retries.
    console.warn(`[ensure-deps] npm install exited ${res.status} but dependencies are present — continuing.`);
  }
  console.log('[ensure-deps] Dependencies installed.');
  return { name: 'node_modules', path: path.join(ROOT, 'node_modules'), downloaded: true };
}

// Ensures the ffmpeg binary for this platform exists inside ffmpeg-static.
// If the binary is missing (e.g. the package was installed on a different OS
// and the zip copied over), re-runs the package's own install script, which
// knows the correct release asset and honors HTTPS_PROXY / FFMPEG_BINARY_RELEASE.
async function ensureFfmpeg() {
  if (process.env.SKIP_BOOTSTRAP === '1') return { name: 'ffmpeg', skipped: true };
  if (!fs.existsSync(path.join(FFMPEG_STATIC_DIR, 'package.json'))) {
    throw new Error('ffmpeg-static is not installed yet');
  }

  let target;
  try {
    target = require(path.join(FFMPEG_STATIC_DIR, 'index.js'));
  } catch (err) {
    throw new Error(`ffmpeg-static is broken: ${err && err.message}`);
  }
  if (!target) throw new Error('ffmpeg-static: no binary available for this platform/arch');

  if (fs.existsSync(target)) {
    try { fs.chmodSync(target, 0o755); } catch { /* ignore */ }
    return { name: 'ffmpeg', path: target, skipped: true };
  }

  if (process.env.FFMPEG_BIN) {
    // FFMPEG_BIN points somewhere the package can't produce for us — the
    // user is expected to place the binary themselves.
    throw new Error(`ffmpeg binary not found at ${target} (FFMPEG_BIN is set)`);
  }

  console.log(`[ensure-deps] Downloading ffmpeg for ${process.platform} → ${target}`);
  const res = spawnSync(process.execPath, ['install.js'], {
    cwd: FFMPEG_STATIC_DIR,
    stdio: 'inherit',
    timeout: 600_000,
  });
  if (res.error) throw new Error(`ffmpeg download failed: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`ffmpeg download failed (exit ${res.status})`);
  if (!fs.existsSync(target)) throw new Error(`ffmpeg download finished but binary missing at ${target}`);
  return { name: 'ffmpeg', path: target, downloaded: true };
}

// Runs both self-heals, never rejects — failures become warnings so the
// supervisor / npm lifecycle keeps going. Returns per-binary results.
async function main() {
  if (process.env.SKIP_BOOTSTRAP === '1') {
    console.log('[ensure-deps] SKIP_BOOTSTRAP=1 — skipping dependency bootstrap');
    return { skipped: true };
  }
  const results = {};
  // node_modules first: ffmpeg-static only exists once installed.
  for (const fn of [ensureNodeModules, ensureFfmpeg]) {
    try {
      const r = await fn();
      results[r.name] = r;
      if (r.downloaded) console.log(`[ensure-deps] ${r.name} ready at ${r.path}`);
    } catch (err) {
      lastError = err;
      results[fn.name || 'unknown'] = { error: err.message };
      console.warn(`[ensure-deps] ${err.message}`);
    }
  }
  return results;
}

module.exports = { main, ensureNodeModules };

if (require.main === module) {
  main()
    .then(() => {
      process.exitCode = lastError ? 1 : 0;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
