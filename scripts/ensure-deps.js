// Self-healing dependency bootstrap.
//
// Installs the project's npm dependencies when they are missing, then
// downloads the correct yt-dlp / ffmpeg binary for the CURRENT platform when
// it is missing. This matters because zipped `node_modules` folders are often
// moved between Windows and Linux (or uploaded to a VPS), leaving binaries
// for the wrong OS behind — @discordjs/voice then fails to decode audio.
//
// Invoked from:
//   - package.json `postinstall` / `prestart` (CLI entry)
//   - run.js             via  .main()        before spawning the bot
//   - musicManager.js    via  .ensureYtDlp() as a one-time runtime self-heal
//
// Set SKIP_BOOTSTRAP=1 to skip entirely (offline development).

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const IS_WIN32 = process.platform === 'win32';
const YT_DLP_BIN_DIR = path.join(ROOT, 'node_modules', '@distube', 'yt-dlp', 'bin');
const FFMPEG_STATIC_DIR = path.join(ROOT, 'node_modules', 'ffmpeg-static');

let lastError = null;

// Downloads a binary over HTTPS, following redirects (GitHub release assets
// redirect to object storage). Writes to a temp file first so a partial
// download never leaves a corrupted binary at the destination path.
function downloadTo(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'biscord-ensure-deps' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        resolve(downloadTo(next, dest));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const tmp = `${dest}.tmp-${process.pid}`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          fs.renameSync(tmp, dest);
          resolve();
        });
      });
      out.on('error', (err) => {
        try { fs.unlinkSync(tmp); } catch { /* already gone */ }
        reject(err);
      });
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('download timed out')));
  });
}

// GETs a small text resource (e.g. a checksum manifest) over HTTPS, following
// redirects. Used only for integrity metadata, never for binaries.
function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'biscord-ensure-deps' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 5) { reject(new Error(`too many redirects for ${url}`)); return; }
        resolve(fetchText(new URL(res.headers.location, url).href, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('request timed out')));
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// Verifies a downloaded yt-dlp binary against its published SHA-256 before it is
// ever executed. This matters because ensure-deps runs binaries it fetched from
// the network: without a checksum, a MITM or a compromised release asset would
// be arbitrary code execution.
//
// Verification order:
//   1. YTDLP_SHA256                — a pinned hex digest (works with YTDLP_URL).
//   2. YTDLP_CHECKSUM_URL          — a custom SHA256SUMS manifest.
//   3. <release dir>/SHA2-256SUMS  — the manifest GitHub publishes alongside it.
// Fails closed: an unverifiable download is deleted, never executed. Set
// YTDLP_SKIP_CHECKSUM=1 to bypass (not recommended — prints a loud warning).
async function verifyYtDlpChecksum(file, url, filename) {
  if (process.env.YTDLP_SKIP_CHECKSUM === '1') {
    console.warn('[ensure-deps] WARNING: YTDLP_SKIP_CHECKSUM=1 — downloaded binary was NOT integrity-verified.');
    return;
  }

  let expected = (process.env.YTDLP_SHA256 || '').trim();

  if (!expected) {
    const sumsUrl = process.env.YTDLP_CHECKSUM_URL || url.replace(/[^/]+$/, 'SHA2-256SUMS');
    let sums;
    try {
      sums = await fetchText(sumsUrl);
    } catch (err) {
      try { fs.unlinkSync(file); } catch { /* already gone */ }
      throw new Error(
        `could not fetch checksums from ${sumsUrl} (${err.message}). Refusing to run an unverified ` +
        'binary. Set YTDLP_SHA256=<hex> to pin a digest, or YTDLP_SKIP_CHECKSUM=1 to bypass (not recommended).',
      );
    }
    for (const line of sums.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const name = parts[parts.length - 1].replace(/^\*/, '');
      if (name === filename) { expected = parts[0]; break; }
    }
    if (!expected) {
      try { fs.unlinkSync(file); } catch { /* already gone */ }
      throw new Error(
        `no SHA-256 entry for ${filename} in ${sumsUrl}. Refusing to run an unverified binary ` +
        '(set YTDLP_SHA256=<hex> or YTDLP_SKIP_CHECKSUM=1 to override).',
      );
    }
  }

  const actual = await sha256File(file);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
    throw new Error(
      `SHA-256 mismatch for ${filename}: expected ${expected}, got ${actual}. ` +
      'The download was rejected and deleted.',
    );
  }
}

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
  // On Windows npm is a .cmd shim, so it must be resolved via the shell.
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
    // e.g. only the ffmpeg/yt-dlp binary step in `postinstall` failed — the
    // packages themselves are fine, and ensureFfmpeg/ensureYtDlp below retry.
    console.warn(`[ensure-deps] npm install exited ${res.status} but dependencies are present — continuing.`);
  }
  console.log('[ensure-deps] Dependencies installed.');
  return { name: 'node_modules', path: path.join(ROOT, 'node_modules'), downloaded: true };
}

// Ensures the yt-dlp binary for this platform exists in the @distube/yt-dlp
// bin folder (the location musicManager.js resolves to). Honors the same env
// overrides as musicManager: YT_DLP_BINARY_PATH / YTDLP_PATH (file or dir),
// YTDLP_DIR, YTDLP_FILENAME and YTDLP_URL. Throws if the binary cannot be
// produced. Returns an object describing what happened.
async function ensureYtDlp() {
  if (process.env.SKIP_BOOTSTRAP === '1') return { name: 'yt-dlp', skipped: true };

  const binDir = process.env.YTDLP_DIR || YT_DLP_BIN_DIR;
  const filename = process.env.YTDLP_FILENAME || (IS_WIN32 ? 'yt-dlp.exe' : 'yt-dlp');
  const bundled = path.join(binDir, filename);

  const override = process.env.YT_DLP_BINARY_PATH || process.env.YTDLP_PATH;
  if (override) {
    const st = fs.statSync(override, { throwIfNoEntry: false });
    if (st && st.isFile()) return { name: 'yt-dlp', path: override, skipped: true };
    if (st && st.isDirectory()) {
      const inside = path.join(override, filename);
      if (fs.existsSync(inside)) return { name: 'yt-dlp', path: inside, skipped: true };
    }
  }

  if (fs.existsSync(bundled)) {
    if (!IS_WIN32) try { fs.chmodSync(bundled, 0o755); } catch { /* ignore */ }
    return { name: 'yt-dlp', path: bundled, skipped: true };
  }

  if (process.env.YTDLP_DISABLE_DOWNLOAD === '1') {
    throw new Error(`yt-dlp binary missing at ${bundled} and YTDLP_DISABLE_DOWNLOAD is set`);
  }

  const url = process.env.YTDLP_URL || `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${filename}`;
  console.log(`[ensure-deps] Downloading yt-dlp for ${process.platform} → ${bundled}`);
  fs.mkdirSync(binDir, { recursive: true });
  await downloadTo(url, bundled);
  await verifyYtDlpChecksum(bundled, url, filename);
  try { fs.chmodSync(bundled, 0o755); } catch { /* ignore */ }
  return { name: 'yt-dlp', path: bundled, downloaded: true };
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
  const override = process.env.FFMPEG_BIN;
  // A valid explicit FFMPEG_BIN wins — no need to heal the bundled copy.
  if (override && fs.existsSync(override)) {
    return { name: 'ffmpeg', path: override, skipped: true };
  }
  // Otherwise resolve the *bundled* binary for this platform. ffmpeg-static
  // returns FFMPEG_BIN verbatim when it is set, which may point at a wrong-OS
  // path (e.g. a Linux path on Windows) and hide a genuinely missing binary —
  // so clear the override (and the require cache) while asking the package.
  try {
    const indexPath = path.join(FFMPEG_STATIC_DIR, 'index.js');
    delete require.cache[require.resolve(indexPath)];
    delete process.env.FFMPEG_BIN;
    target = require(indexPath);
  } catch (err) {
    throw new Error(`ffmpeg-static is broken: ${err && err.message}`);
  } finally {
    if (override !== undefined) process.env.FFMPEG_BIN = override;
  }
  if (!target) throw new Error('ffmpeg-static: no binary available for this platform/arch');

  if (fs.existsSync(target)) {
    try { fs.chmodSync(target, 0o755); } catch { /* ignore */ }
    return { name: 'ffmpeg', path: target, skipped: true };
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
  // node_modules first: ffmpeg-static / @distube/yt-dlp only exist once installed.
  for (const fn of [ensureNodeModules, ensureYtDlp, ensureFfmpeg]) {
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

module.exports = { main, ensureNodeModules, ensureYtDlp, verifyYtDlpChecksum, sha256File };

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