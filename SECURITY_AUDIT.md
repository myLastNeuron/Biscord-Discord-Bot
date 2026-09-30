# Security Audit — Biscord

**Scope:** the code in this repository at the audited commit.
**Date:** 2026-09-30
**Auditor:** external, assisted review (static analysis + manual code reading)
**Status:** findings below are **remediated in the accompanying commits** unless noted otherwise.

Biscord is self-hosted software that downloads and executes third-party
binaries, holds a privileged Discord bot token, and runs inside a community
where log channels are often broadly readable. This audit focused on those
three surfaces. It is a best-effort review, **not** a formal penetration test
or a guarantee of security.

---

## Summary

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | **Critical** | Runtime binary downloads were executed without any integrity verification | Fixed |
| 2 | **Critical / High** | Vulnerable dependencies (`tar` via `@discordjs/opus` → `node-pre-gyp`) | Fixed |
| 3 | **Medium** | Error stack traces broadcast into community log channels | Fixed |
| 4 | **Medium** | Voice-takeover commands were not permission-gated | Fixed |
| 5 | **Low** | `ffmpeg` self-heal downloads are not checksum-verified | Documented |

Dependency check after the fix: `npm audit --omit=dev` → **0 vulnerabilities**.

---

## 1. Unverified binary downloads → arbitrary code execution

**Severity: Critical**

`scripts/ensure-deps.js` downloads `yt-dlp` and `ffmpeg` at install and at
first run, then marks them executable and spawns them. The download followed
redirects and had **no checksum or signature verification**:

```js
await downloadTo(url, bundled);      // fetched from GitHub releases, redirects followed
fs.chmodSync(bundled, 0o755);        // made executable
// ...later executed via execFile(bin, args)
```

**Impact.** A network attacker able to intercept the download, a compromised
upstream release asset, or a malicious value in `YTDLP_URL` would achieve
arbitrary code execution on the host with the bot's privileges. This is the
most serious issue found because it directly runs attacker-controlled code.

**Fix.** `ensure-deps.js` now computes the SHA-256 of the downloaded `yt-dlp`
binary and compares it against the release's published `SHA2-256SUMS` manifest
before the file is ever made executable. It **fails closed**: an unverifiable
or mismatched download is deleted, not run.

- `YTDLP_SHA256=<hex>` pins an exact digest (also covers custom `YTDLP_URL`).
- `YTDLP_CHECKSUM_URL=<url>` points at a custom manifest.
- `YTDLP_SKIP_CHECKSUM=1` bypasses verification and prints a loud warning.

**Residual.** The `ffmpeg` path delegates to `ffmpeg-static`'s own install
script (see finding 5).

---

## 2. Vulnerable dependencies

**Severity: Critical / High**

`npm audit --omit=dev` reported 3 advisories:

- **Critical — `tar` ≤ 7.5.20**: hardlink/symlink path traversal and arbitrary
  file overwrite during extraction (multiple GHSA advisories).
- **High — `@discordjs/opus`**: denial-of-service (GHSA-43wq-xrcm-3vgr).

Both arrive transitively via `@discordjs/opus → @discordjs/node-pre-gyp → tar`.
The vulnerable `tar` line is `^6.1.11`, and the 6.x branch has **no patched
release**, so bumping `@discordjs/opus` alone does not clear it.

**Fix.**

- `@discordjs/opus` bumped `^0.9.0` → `^0.10.0` (clears the DoS advisory;
  upstream marks this a breaking change — re-test voice after upgrading).
- Added an npm `overrides` entry pinning `tar` to `^7.5.22`, which forces the
  patched major across the tree.

`npm audit --omit=dev` now reports **0 vulnerabilities**.

**Note.** `tar` is only exercised at install time by `node-pre-gyp`; it is not
on the bot's runtime request path. The override to `tar@7` should be validated
by a clean `npm install` on each target platform.

---

## 3. Stack traces leaked into community channels

**Severity: Medium**

`utils/errorHandler.js` broadcast raw `error.stack` (up to 1500 chars) into
every guild's configured log channel:

```js
const msg = `⚠️ **${context}**\n\`\`\`${error.message}\n${error.stack?.slice(0, 1500)}\`\`\``;
```

**Impact.** Stack traces reveal absolute file paths, internal module structure,
and dependency versions to anyone who can read those channels — useful
reconnaissance, and an unnecessary information leak in normal operation.

**Fix.** Log-channel reports now contain only the context and a short,
truncated message. Full stacks still go to the local console/log file. Set
`LOG_ERROR_STACKS=1` to intentionally include them.

---

## 4. Voice commands were not permission-gated

**Severity: Medium**

`/join`, `/connect`, and the `start` subcommand of `/tts-live` had no
`setDefaultMemberPermissions`, so **any member** could pull the bot into a
voice channel, keep it there, and make it read an arbitrary text channel
aloud.

**Impact.** Resource abuse and harassment vector (surveillance-style audio
playback in a channel the caller chooses), not data loss.

**Fix.** These now require `MoveMembers`:

- `/connect`
- `/join`
- `/tts-live start` (only `start`; `stop`/`status`/`test` stay open so anyone
  can mute or inspect an active session)

Servers that intentionally want these open can remove the
`setDefaultMemberPermissions(...)` line in the relevant command file.

---

## 5. `ffmpeg` self-heal is not checksum-verified

**Severity: Low (documented, not fixed)**

`ensure-deps.js` re-runs `ffmpeg-static`'s `install.js` when the `ffmpeg`
binary is missing. Integrity depends entirely on that package's own download
logic, which the project does not verify independently. This mirrors finding 1
but for the `ffmpeg` binary.

**Recommendation.** If `ffmpeg-static` ever gains a checksum manifest, verify
it the same way `yt-dlp` is now verified. Until then, treat the network path
for `ffmpeg` as trusted-but-unverified.

---

## Reviewed and found sound

These were checked and did **not** produce findings:

- **No hardcoded secrets.** `.env`, `data/`, logs, and `cookies.txt` are all
  gitignored; no bot token or credential appears in source.
- **No shell-command injection.** `yt-dlp` and `ffmpeg` are invoked via
  `execFile`/`spawn` (no shell). The only `execSync` calls are fixed strings
  (`where yt-dlp` / `which yt-dlp`).
- **Mutating actions are gated.** Dashboard/panel mutations require `ManageGuild`;
  bot-wide config requires `Administrator`.
- **No web attack surface.** There is no HTTP server; the "dashboard" is
  Discord-interaction driven.
- **Atomic state writes.** `utils/safeFile.js` uses temp-file + rename, and
  `db.js` coalesces writes — a crash cannot truncate the JSON store.
- **Container hygiene.** The Dockerfile runs as the non-root `node` user and
  installs production dependencies only.
- **No `eval` or user-controlled dynamic `require`.**

---

## How to reproduce the dependency check

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm audit --omit=dev        # expect: found 0 vulnerabilities
```

## Disclaimer

This audit reflects the state of the code at the audited commit and the
reviewer's best effort. It does not cover the Discord API, the host OS, the
network, or third-party services, and it is not a warranty of any kind.
Biscord remains, per its README, a largely AI-generated learning project — use
it at your own risk.
