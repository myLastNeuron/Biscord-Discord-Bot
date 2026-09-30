'use strict';

// Shared ffmpeg-binary resolution for music + live TTS.
//
// `@discordjs/voice` decodes `Arbitrary` streams by spawning `ffmpeg` from
// PATH, so we prefix the bundled ffmpeg-static directory onto PATH.
//
// Gotcha: ffmpeg-static treats the FFMPEG_BIN env var as a hard override and
// returns it *verbatim* (see node_modules/ffmpeg-static/index.js). The default
// .env ships a Linux-style relative path (`./node_modules/ffmpeg-static/ffmpeg`,
// no `.exe`), so on Windows that override exists-but-is-wrong and the bundled
// `ffmpeg.exe` is never found. Prefer FFMPEG_BIN only when it actually resolves;
// otherwise fall back to the bundled binary for the current platform.

const fs = require('fs');
const path = require('path');

// Returns the ffmpeg path to use, or null if ffmpeg-static isn't installed.
function resolveFfmpegBin() {
  const override = process.env.FFMPEG_BIN;
  if (override && fs.existsSync(override)) return override;

  try {
    const pkgDir = path.dirname(require.resolve('ffmpeg-static'));
    const meta = require(path.join(pkgDir, 'package.json'))['ffmpeg-static'] || {};
    const base = meta['executable-base-name'] || 'ffmpeg';
    const candidate = path.join(pkgDir, base + (process.platform === 'win32' ? '.exe' : ''));
    // May not exist yet (fresh/platform-swapped install) — the bootstrap
    // (`scripts/ensure-deps.js`) downloads it. Callers warn in that case.
    return candidate;
  } catch {
    return null; // ffmpeg-static not installed
  }
}

// Resolves ffmpeg, makes it executable on POSIX, and puts its directory on
// PATH so @discordjs/voice can find it. Idempotent, never throws. Returns the
// resolved path, or null when ffmpeg-static is unavailable.
function exposeFfmpegOnPath() {
  const bin = resolveFfmpegBin();
  if (!bin) return null;

  try {
    if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  } catch { /* ignore */ }

  const dir = path.dirname(bin);
  const entries = (process.env.PATH || '').split(path.delimiter);
  if (!entries.includes(dir)) {
    process.env.PATH = dir + path.delimiter + (process.env.PATH || '');
  }
  return bin;
}

module.exports = { resolveFfmpegBin, exposeFfmpegOnPath };
