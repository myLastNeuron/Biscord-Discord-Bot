// Shared JSON-file helpers used by every store in utils/.
//
// These exist so the "tiny JSON database" pattern is implemented the same,
// safe way everywhere instead of each store doing its own writeFileSync:
//
//   - dataPath(name)      resolves a file inside the bot's data directory and
//                         honours the DATA_DIR env override (used by tests and
//                         by hosts that want runtime state on a mounted volume).
//   - readJson(file, fb)  parses JSON and returns `fb` on any read/parse error.
//   - writeJsonAtomic()   writes via a temp file + rename, so an interrupted
//                         write can never leave a truncated/corrupt JSON file.

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

function dataPath(name) {
  return path.join(DATA_DIR, name);
}

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8').trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    // rename() replaces the destination atomically on both Windows and POSIX.
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw err;
  }
}

module.exports = { DATA_DIR, dataPath, readJson, writeJsonAtomic };
