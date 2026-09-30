<div align="center">

# 🎛️ BISCORD

**An all-in-one, self-hosted Discord bot for communities that want moderation, events, music and a live control panel — without standing up a database.**

Moderation · Event Rosters · Giveaways · Polls · Music · Live Dashboard · TTS · Voice Tools · Levels · Tickets

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.17-339933?style=for-the-badge&logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
[![CI](https://github.com/myLastNeuron/biscord-discord-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/myLastNeuron/biscord-discord-bot/actions/workflows/ci.yml)
![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=for-the-badge)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge)](https://github.com/myLastNeuron/biscord-discord-bot/pulls)

**[Quick Start](#-quick-start)** · **[Features](#-features)** · **[Commands](#-command-reference)** · **[Configuration](#-configuration)** · **[Security](#-security)** · **[Contributing](#-contributing)**

</div>

---

## ✨ Why Biscord?

Most "all-in-one" bots either charge a subscription or dump your data on someone else's server. Biscord runs **on your machine, under your control**, and stores everything in plain JSON you can read, back up, and move with a single folder copy.

| | |
|---|---|
| 🗄️ **No database required** | All state lives in `data/` as readable JSON — back it up by copying a folder |
| 🩺 **Self-healing & verified** | Auto-downloads the right `ffmpeg` / `yt-dlp` for Windows **or** Linux — the `yt-dlp` download is **SHA-256 verified** before it runs — and `run.js` restarts the bot if it ever crashes |
| 🖱️ **Click-first setup** | `/panel` is a live dashboard — welcome, logging, tickets, levels, temp VCs, invite tracking and more, all driven by buttons and modals |
| 📅 **Built for event communities** | Roster sign-ups with main/sub slots, attendance stats, recurring auto-posts, giveaways and polls |
| 🧱 **Hardened data layer** | Atomic (temp-file + rename) and batched writes, so a crash can't corrupt your JSON |
| ✅ **Tested & linted** | `npm test` and `npm run lint`, enforced on every push by GitHub Actions |

### At a glance

| 🧩 Commands | 🗂️ Feature modules | 🗄️ Database | 🎵 Music + TTS | 🛡️ Supervision |
|:---:|:---:|:---:|:---:|:---:|
| **45** slash commands | **24** | **none** — plain JSON | self-healing binaries | crash auto-restart |

---

## 🚀 Quick Start

> **Prerequisites:** [Node.js](https://nodejs.org) **18.17+** and a bot application from the [Discord Developer Portal](https://discord.com/developers/applications).

**1. Clone and install** — the postinstall step fetches `ffmpeg` / `yt-dlp` for your platform.

```bash
git clone https://github.com/myLastNeuron/biscord-discord-bot.git
cd biscord-discord-bot
npm install
```

**2. Configure your credentials.**

```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_guild_id_here   # optional: instant command registration in one server
```

**3. Register the slash commands.**

```bash
npm run deploy
```

**4. Start the bot.**

```bash
npm start
```

You should see the ASCII banner once the bot connects. Run `/panel` in your server to open the dashboard. 🎉

> [!TIP]
> Always start the bot through `npm start` (which runs `run.js`). Running `index.js` directly skips the supervisor, the auto-restart, and the binary self-heal.

### 🐳 Run with Docker

```bash
docker build -t biscord .
docker run -d --name biscord --env-file .env -v biscord-data:/app/data biscord
```

The image installs production dependencies only and fetches the correct music binaries on first start. Mount a volume at `/app/data` to persist state across rebuilds.

---

## 🎯 Features

Everything below is included — nothing is behind a paywall.

| Module | What it does |
|---|---|
| 🛡️ **Moderation** | Ban, kick, timeout, warn, purge, channel lock, media-only channels, server-wide lockdown |
| 📅 **Event Rosters** | Reaction/button sign-up panels with main + sub slots, auto-lock, attendance stats |
| 🎁 **Giveaways** | Timed giveaways with a join button, instant end, and winner re-rolls |
| 📊 **Polls** | Multi-option polls with live results |
| 🎵 **Music** | YouTube playback by name or URL, queue, loop, shuffle, volume |
| 🔊 **Voice Tools** | Keep-alive VC connection, VC member list, join/leave logging, join notifications |
| 🗣️ **TTS** | Text-to-speech files and real-time "read this channel aloud" |
| 🧩 **Embeds** | A visual embed builder with saved, reusable templates |
| 🏆 **Levels** | XP from messages, voice, reactions; custom level roles and leaderboards |
| 🎟️ **Tickets** | Support ticket panels with transcripts and staff roles |
| 📨 **Invite Tracking** | Who invited whom, with leaderboards and rejoin/leave accounting |
| 🛠️ **Live Dashboard** | One `/panel` for config, plus auto-refreshing status embeds and stat channels |

---

## 📜 Command Reference

All **45** top-level slash commands, grouped by module. Expand a section to see its commands.

<details>
<summary><b>🛡️ Moderation</b> — 10 commands</summary>

| Command | Description |
|---------|-------------|
| `/ban` | Ban a member, with optional message deletion |
| `/kick` | Kick a member from the server |
| `/timeout` | Timeout (mute) a member for a duration |
| `/untimeout` | Remove an active timeout |
| `/warn` | Issue a warning to a member |
| `/warnings` | View, list, or clear member warnings |
| `/purge` | Bulk delete recent messages (1–100) |
| `/channel-lock` | Lock/unlock a text channel |
| `/media-only` | Make a channel file/picture only, with auto-delete + auto-warn |
| `/lockdown` | Server-wide raid lock — locks every channel, then reverts |

</details>

<details>
<summary><b>📅 Event Rosters</b> — 3 commands</summary>

| Command | Description |
|---------|-------------|
| `/event` | Create, list, close or delete roster sign-up panels (main/sub slots) |
| `/event autopost` | Set up daily recurring roster panels |
| `/roster-lock-time` | Set default auto-lock minutes for rosters |
| `/stats` | View event attendance stats per member |

</details>

<details>
<summary><b>🎁 Giveaways</b></summary>

| Command | Description |
|---------|-------------|
| `/giveaway create` | Start a timed giveaway with a custom join button |
| `/giveaway end` | End a giveaway immediately and draw winners |
| `/giveaway reroll` | Re-draw winners for an ended giveaway |
| `/giveaway list` | View all giveaways in the server |
| `/giveaway delete` | Delete a giveaway record |

</details>

<details>
<summary><b>📊 Polls</b></summary>

| Command | Description |
|---------|-------------|
| `/poll create` | Create a poll with multiple options |
| `/poll end` | End a poll immediately |
| `/poll results` | View current results |
| `/poll delete` | Delete a poll record |

</details>

<details>
<summary><b>🎵 Music</b></summary>

| Command | Description |
|---------|-------------|
| `/music play` | Play a song by name or YouTube URL |
| `/music pause` · `/music resume` | Pause / resume playback |
| `/music skip` | Skip to the next song |
| `/music shuffle` | Shuffle the queue |
| `/music stop` | Stop playback and clear the queue |
| `/music queue` · `/music nowplaying` | Show the queue / current track |
| `/music loop` · `/music volume` · `/music remove` | Loop mode, volume, remove a queued song |

</details>

<details>
<summary><b>🔊 Voice Tools</b></summary>

| Command | Description |
|---------|-------------|
| `/connect` | Join a voice channel and stay connected · **Move Members** |
| `/join` | Join a voice channel and read chat aloud · **Move Members** |
| `/leave` | Disconnect from voice |
| `/server-status` | Live server stats — members, online, idle, DND (auto-refresh) |
| `/vc-members` | Show members currently in a voice channel |
| `/vcactivity` | Log when members join/leave voice, with a duration timer |
| `/vcnotify` | Get notified when a specific user joins a voice channel |

</details>

<details>
<summary><b>🗣️ TTS</b></summary>

| Command | Description |
|---------|-------------|
| `/tts` | Convert text to a voice MP3 file |
| `/tts-live` | Read a text channel aloud in voice, in real time (`start` needs **Move Members**; `stop`/`status`/`test` are open) |

</details>

<details>
<summary><b>🧩 Embeds</b></summary>

| Command | Description |
|---------|-------------|
| `/embed` | Open the live builder / edit / send a saved template |
| `/embed list` · `/embed delete` | List or delete saved templates |

</details>

<details>
<summary><b>🏆 Levels</b></summary>

| Command | Description |
|---------|-------------|
| `/panel-levels` | Configure the level system from the dashboard |
| `/rank` · `/leaderboard` | Show a member's rank / the server leaderboard |
| `/give-xp` · `/cheat-level` · `/reset-level` | Admin XP and level tools |

</details>

<details>
<summary><b>✨ Community & Utility</b></summary>

| Command | Description |
|---------|-------------|
| `/welcome` | Configure and test the welcome message |
| `/autoreact` | Auto-react to messages matching rules |
| `/react` | React to a specific message |
| `/replyback` | Auto-reply when a user sends a message |
| `/autodelete` | Auto-delete messages by prefix or user |
| `/rolerequest` | Post a role request panel |
| `/ticket` | Post a support ticket panel |
| `/schedule` | Schedule a message for a future time |
| `/bot-config` | Edit the bot's status, avatar, and username |
| `/help` | See every command and feature |
| `/monopoly` | Create a Monopoly room on Aspal.io |

</details>

### 🛠️ The dashboard: `/panel`

One command opens a button-driven control centre for the whole server:

> welcome channels · logging · audit log · mod roles · role requests · tickets · reaction approval · auto-react · upcoming board · giveaways · invite tracker · level system · temp voice channels · bot config · stats channels — and more.

Embeds built with `/embed`, welcome messages, and `/server-status` all **auto-refresh in place** rather than spamming new messages.

---

## 🧰 Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18.17+ (CommonJS) |
| Library | [discord.js](https://discord.js.org) v14 |
| Voice | `@discordjs/voice`, `@discordjs/opus`, `opusscript` |
| Music | `@distube/yt-dlp`, `ffmpeg-static` |
| Encryption | `libsodium-wrappers` |
| Storage | JSON file store (`data/`) — no external database |
| Config | `dotenv` |
| Tests | `node:test` (built-in, no extra dependencies) |
| Lint | ESLint 9 (flat config) |
| CI | GitHub Actions — Node 20 / 22 / 24 |

---

## 🏗️ How it works

```
  ┌──────────────┐   spawns     ┌───────────────────────────────┐
  │   run.js     │─────────────▶│  index.js                     │
  │ supervisor   │              │  Discord client               │
  │ • self-heal  │◀─────────────│  commands/ · events/ ·        │
  │ • auto-restart│  exit code  │  handlers/                    │
  └──────────────┘              └──────────────┬────────────────┘
                                                │
                          ┌─────────────────────┼─────────────────────┐
                          ▼                     ▼                     ▼
                   ┌─────────────┐      ┌──────────────┐      ┌──────────────┐
                   │  utils/*    │      │ data/*.json  │      │ Discord API  │
                   │  managers,  │      │ atomic +     │      │              │
                   │  builders,  │      │ batched I/O  │      │              │
                   │  schedulers │      │              │      │              │
                   └─────────────┘      └──────────────┘      └──────────────┘
```

- **`run.js`** is the only entry point you run. It bootstraps the music binaries, spawns `index.js`, and respawns it (with backoff) if it exits non-zero.
- **`index.js`** creates the Discord client, loads `commands/` and `events/`, and starts the background schedulers.
- **`utils/`** holds the managers and builders (music, levels, giveaways, polls, rosters, embeds, tickets…).
- **`utils/safeFile.js`** is the shared JSON layer: writes go to a temp file then rename (atomic), and multiple changes in the same tick collapse into one write.

Runtime state is just files under `data/` — `guildSettings.json`, `events.json`, `warnings.json`, `giveaways.json`, `polls.json`, `invites.json`, `levels.json`, and friends. Back up the folder and you've backed up the bot.

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and fill in at least the two required values.

| Variable | Required | Description |
|----------|:--------:|-------------|
| `DISCORD_TOKEN` | ✅ | Bot token from the Discord Developer Portal |
| `CLIENT_ID` | ✅ | Application (client) ID for the bot |
| `GUILD_ID` | ❌ | Server ID — registers commands instantly to that guild (great for testing) |
| `STATS_MEMBERS_CHANNEL_ID` | ❌ | Voice channel whose name shows the member count |
| `STATS_ONLINE_CHANNEL_ID` | ❌ | Voice channel whose name shows the online count |
| `YT_DLP_BINARY_PATH` | ❌ | Custom path to the `yt-dlp` binary (Linux hosting) |
| `FFMPEG_BIN` | ❌ | Custom path to the `ffmpeg` binary (Linux hosting) |
| `YTDLP_COOKIES` | ❌ | Path to a Netscape `cookies.txt` — fixes YouTube "confirm you're not a bot" on VPS/datacenter hosts |
| `DATA_DIR` | ❌ | Override where runtime JSON state is stored (default `./data`) |
| `LOG_LEVEL` | ❌ | `debug` \| `info` \| `warn` \| `error` (default `info`) |
| `SKIP_BOOTSTRAP` | ❌ | Set to `1` to skip the `ffmpeg` / `yt-dlp` bootstrap (offline dev) |
| `YTDLP_SHA256` | ❌ | Pin the expected SHA-256 of the downloaded `yt-dlp` binary (default: verified against the release's `SHA2-256SUMS`) |
| `YTDLP_CHECKSUM_URL` | ❌ | Custom `SHA256SUMS` manifest URL to verify `yt-dlp` against |
| `YTDLP_SKIP_CHECKSUM` | ❌ | Set to `1` to skip `yt-dlp` checksum verification (not recommended — the download then runs unverified) |
| `LOG_ERROR_STACKS` | ❌ | Set to `1` to include full stack traces in log-channel error reports (off by default to avoid leaking paths) |

The `.env` file, runtime data in `data/`, and all logs are excluded from version control.

---

## 📁 Project Structure

```
├── commands/              Slash commands, one folder per feature
│   ├── Moderation/        ban, kick, timeout, warnings, purge, lockdown…
│   ├── Events/            roster panels, autopost, attendance stats
│   ├── Giveaways/         giveaway lifecycle
│   ├── Music/             playback, queue, loop, volume
│   ├── Levels/            xp, rank, leaderboard, panel
│   ├── Dashboard/         the /panel control centre
│   └── …                  AutoReact, Polls, Tickets, TTS, Voice*, Welcome…
├── events/                Discord.js event handlers (messageCreate, voiceStateUpdate…)
├── handlers/              Button / modal / select-menu interactions
├── utils/                 Managers, builders, schedulers, JSON store
│   ├── safeFile.js        Atomic + batched JSON writes
│   └── db.js              The guild/event/warning/giveaway data API
├── scripts/               ensure-deps, deploy-commands, tooling
├── test/                  Unit tests (node:test)
├── data/                  Runtime JSON state (gitignored)
├── index.js               Bot entry point (Discord client)
├── run.js                 Process supervisor: self-heal + auto-restart
├── eslint.config.js       ESLint flat config
├── Dockerfile             Production container image
├── SECURITY_AUDIT.md      Security audit report (findings + fixes)
└── package.json
```

---

## 🛠️ Development

Install once (`npm install`), then:

```bash
npm run lint   # ESLint (flat config)
npm test       # unit tests (node:test)
```

| Script | Command | Purpose |
|--------|---------|---------|
| Start | `npm start` | Run the bot under `run.js` with auto-restart |
| Deploy | `npm run deploy` | Register slash commands with Discord |
| Lint | `npm run lint` | Run ESLint |
| Test | `npm test` | Run the unit tests |
| Bootstrap | (auto) | Ensures correct `yt-dlp` / `ffmpeg` binaries |

Both checks run on every push and pull request via [`.github/workflows/ci.yml`](.github/workflows/ci.yml), across Node 20, 22 and 24.

---

## ❓ FAQ & Troubleshooting

**Music or TTS doesn't play / "wrong binary" errors on Linux**
The `ensure-deps` step swaps Windows binaries for Linux ones automatically. If it was skipped (`SKIP_BOOTSTRAP=1`) or failed, re-run `npm install`, or point `YT_DLP_BINARY_PATH` / `FFMPEG_BIN` at your own binaries.

**`ensure-deps` refuses the yt-dlp download / "SHA-256 mismatch"**
The fetched `yt-dlp` is checked against the release's published `SHA2-256SUMS`, and an unverifiable download is deleted rather than run. Retry (a flaky network can fail the checksum fetch), or pin a digest with `YTDLP_SHA256=<hex>`. For a custom build, point `YTDLP_CHECKSUM_URL` at its manifest. `YTDLP_SKIP_CHECKSUM=1` skips the check entirely — only if you trust the source.

**Music fails with "Sign in to confirm you're not a bot"**
YouTube blocks datacenter/VPS IPs. Update yt-dlp (`npm install` again) and give it session cookies: export a Netscape-format `cookies.txt` from a logged-in browser, then set `YTDLP_COOKIES=/path/to/cookies.txt` and restart. Keep that file private — it's a login secret.

**A yt-dlp "please remove them from your command/configuration" warning**
That was the deprecated `--youtube-skip-*-manifest` switches ([yt-dlp#14198](https://github.com/yt-dlp/yt-dlp/issues/14198)); recent builds use the `skip` extractor argument instead. Make sure you're on an up-to-date copy — this repo no longer passes the deprecated flags.

**The bot restarts in a loop**
It's blocked during startup — almost always a missing or invalid `DISCORD_TOKEN`. Fix `.env` and check the latest startup log. If the token was reset in the Developer Portal, update `.env`; the old one is rejected with a `401`.

**The bot is online but slash commands don't appear**
Re-invite it with the `applications.commands` scope, then run `npm run deploy` again. Global commands can take up to an hour to propagate; setting `GUILD_ID` registers them instantly to one server.

**Where is my data, and how do I back it up?**
Everything is in `data/`. Copy that folder (or point `DATA_DIR` at a mounted volume) to back up or migrate.

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the repo and create a branch (`git checkout -b feat/my-feature`).
2. Keep the style of the surrounding code and make sure `npm run lint` and `npm test` pass.
3. Open a pull request — CI will run the checks for you.

Found a bug or have an idea? [Open an issue](https://github.com/myLastNeuron/biscord-discord-bot/issues).

---

## 🔐 Security

A security audit was performed on this codebase — the full report, including
evidence and residual risk, lives in **[SECURITY_AUDIT.md](SECURITY_AUDIT.md)**.
What changed as a result:

- **Downloaded binaries are integrity-checked.** The `yt-dlp` binary fetched by
  `ensure-deps` is verified against the release's published `SHA2-256SUMS`
  before it is ever executed; an unverifiable download is deleted, not run.
  See `YTDLP_SHA256` / `YTDLP_CHECKSUM_URL` / `YTDLP_SKIP_CHECKSUM` in
  [Configuration](#-configuration).
- **Dependencies are patched.** `npm audit --omit=dev` reports **0
  vulnerabilities**; an npm `overrides` entry pins `tar` past the critical
  path-traversal advisories.
- **Errors don't leak internals.** Log-channel reports carry a short message
  rather than a stack trace (`LOG_ERROR_STACKS=1` to opt in).
- **Voice takeover is gated.** `/connect`, `/join` and `/tts-live start`
  require the **Move Members** permission.

**Reporting a vulnerability:** please use a
[private security advisory](https://github.com/myLastNeuron/Biscord-Discord-Bot/security/advisories/new)
instead of a public issue.

> This was a single review, not an ongoing programme. It does not make Biscord
> hardened — see the caution below.

---

## 📄 License

Released under the [Apache License 2.0](LICENSE.md).

---

> [!CAUTION]
> ### 🤖 Mostly AI-generated — use at your own risk
>
> I built this bot mostly with AI, as a personal project to understand how AI works and what it can actually do. It is not a professional piece of software, and it has had only a single security pass ([SECURITY_AUDIT.md](SECURITY_AUDIT.md)).
>
> - **Assume there are loopholes, bugs and rough edges.** Some of them I know about, plenty I don't.
> - **One security review has been done — not a hardening programme.** The report is public, but a single pass does not make this safe. Be careful about what you sign in to or store in it.
> - **No warranty of any kind**, in the spirit of the Apache-2.0 license. You use it at your own risk.
> - **It's a learning project first, a Discord bot second.** If something breaks, that's the trade-off.
>
> Treat it as a curious experiment you're welcome to play with — not as software to depend on.

<div align="center">

**Built with [discord.js](https://discord.js.org) · If Biscord helps your server, a ⭐ is appreciated!**

</div>
