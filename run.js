// Lightweight process supervisor - the ONLY thing you should run directly
// (`npm start` -> `node run.js`). Spawns index.js (the actual bot) as a
// child process and respawns it when it exits with a nonzero code, which is
// how /panel > Restart signals a restart is wanted - see the
// `panel:confirmRestartBot` handler in utils/panelInteractionHandler.js,
// which sets data/restartFlag.json then calls `process.exit(1)`. A clean
// exit (code 0 - e.g. Ctrl+C / SIGTERM, handled gracefully by
// utils/errorHandler.js's gracefulShutdown) is NOT respawned; that's a real
// shutdown, not a restart request.
//
// index.js should never be run directly in production - doing so (or
// running this file more than once) starts a second full Discord client +
// scheduler + terminal status-redraw loop alongside whatever's already
// running, which is what duplicated timers/status boxes in the terminal.

const { spawn } = require('child_process');
const path = require('path');

// ---------- Self-healing dependencies (Windows -> Linux / Wispbyte) ----------
// Panels often run `node run.js` directly without `npm install`, and zipped
// `node_modules` from Windows contain the wrong ffmpeg/yt-dlp binaries.
// Run the bootstrap BEFORE spawning the bot so music/voice self-repairs.
// Set SKIP_BOOTSTRAP=1 to skip (offline dev). Never crashes the supervisor.
// AWAITED before startChild() at the bottom of this file: on a fresh copy this
// installs the npm dependencies and downloads the music binaries, and we must
// not spawn index.js until it finishes — otherwise the child crash-loops on
// `Cannot find module 'discord.js'`.


const CHILD_SCRIPT = path.join(__dirname, 'index.js');
const RESPAWN_DELAY_MS = 1000;
// If the child dies again within this long of its own last start, back off
// to a slower respawn instead of hot-looping (e.g. a startup-time crash).
const MIN_UPTIME_MS = 10_000;
const CRASH_LOOP_DELAY_MS = 5000;

let child = null;
let lastStart = 0;
let shuttingDown = false;

function startChild() {
  lastStart = Date.now();
  console.log('[run] Starting bot process...');

  child = spawn(process.execPath, [CHILD_SCRIPT], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    child = null;
    if (shuttingDown) return;

    if (signal) {
      console.log(`[run] Bot process was killed by signal ${signal} - not respawning.`);
      return;
    }

    if (code === 0) {
      console.log('[run] Bot process exited cleanly (code 0) - not respawning.');
      return;
    }

    const ranFor = Date.now() - lastStart;
    const delay = ranFor < MIN_UPTIME_MS ? CRASH_LOOP_DELAY_MS : RESPAWN_DELAY_MS;
    console.log(`[run] Bot process exited with code ${code} - respawning in ${delay}ms...`);
    setTimeout(startChild, delay);
  });

  child.on('error', (err) => {
    console.error('[run] Failed to start bot process:', err);
  });
}

// Forward a real shutdown (Ctrl+C, `docker stop`, etc.) to the child instead
// of leaving it running detached while this supervisor exits.
function shutdown(signal) {
  shuttingDown = true;
  console.log(`[run] Received ${signal}, stopping bot process...`);
  if (child) child.kill(signal);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Bootstrap first (installs npm deps / downloads music binaries), THEN spawn
// the bot, so the child never starts against a half-installed tree.
(async () => {
  try {
    await require('./scripts/ensure-deps').main();
  } catch (err) {
    console.warn(`[run] dependency bootstrap failed (continuing anyway): ${err && err.message}`);
  }
  startChild();
})();
