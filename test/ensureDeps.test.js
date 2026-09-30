'use strict';

// Tests for the yt-dlp download checksum gate in scripts/ensure-deps.js.
// This is a security control (it decides whether a fetched binary is allowed
// to run), so it gets a regression test rather than relying on manual review.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { verifyYtDlpChecksum, sha256File } = require('../scripts/ensure-deps');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biscord-deps-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Preserve and restore the env vars the verifier reads, so tests can't leak
// config into each other.
const ENV_KEYS = ['YTDLP_SHA256', 'YTDLP_CHECKSUM_URL', 'YTDLP_SKIP_CHECKSUM'];
function withEnv(vars, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  return Promise.resolve()
    .then(() => {
      for (const k of ENV_KEYS) delete process.env[k];
      Object.assign(process.env, vars);
      return fn();
    })
    .finally(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

function writeFakeBinary(name, contents) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, contents);
  return file;
}

test('sha256File matches Node crypto for the same bytes', async () => {
  const file = writeFakeBinary('digest.bin', 'hello biscord');
  const expected = crypto.createHash('sha256').update('hello biscord').digest('hex');
  assert.equal(await sha256File(file), expected);
});

test('accepts a binary whose pinned digest matches', async () => {
  const file = writeFakeBinary('yt-dlp-ok', 'trusted payload');
  const expected = crypto.createHash('sha256').update('trusted payload').digest('hex');

  await withEnv({ YTDLP_SHA256: expected }, async () => {
    await verifyYtDlpChecksum(file, 'https://example.invalid/yt-dlp', 'yt-dlp');
  });

  assert.ok(fs.existsSync(file), 'verified binary should be kept');
});

test('rejects and deletes a binary whose digest does not match', async () => {
  const file = writeFakeBinary('yt-dlp-bad', 'tampered payload');

  await withEnv({ YTDLP_SHA256: 'deadbeef'.repeat(8) }, async () => {
    await assert.rejects(
      () => verifyYtDlpChecksum(file, 'https://example.invalid/yt-dlp', 'yt-dlp'),
      /SHA-256 mismatch/,
    );
  });

  assert.equal(fs.existsSync(file), false, 'mismatched binary must be deleted');
});

test('fails closed when checksums cannot be fetched', async () => {
  const file = writeFakeBinary('yt-dlp-nosums', 'payload');

  await withEnv({ YTDLP_CHECKSUM_URL: 'https://127.0.0.1:9/SHA2-256SUMS' }, async () => {
    await assert.rejects(
      () => verifyYtDlpChecksum(file, 'https://example.invalid/yt-dlp', 'yt-dlp'),
      /Refusing to run an unverified/,
    );
  });

  assert.equal(fs.existsSync(file), false, 'unverifiable binary must be deleted');
});

test('YTDLP_SKIP_CHECKSUM=1 bypasses verification with the file intact', async () => {
  const file = writeFakeBinary('yt-dlp-skip', 'anything');
  await withEnv({ YTDLP_SKIP_CHECKSUM: '1' }, async () => {
    await verifyYtDlpChecksum(file, 'https://example.invalid/yt-dlp', 'yt-dlp');
  });
  assert.ok(fs.existsSync(file));
});
