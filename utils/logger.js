// Structured logger with levels, timestamps, and module tags
// Usage: logger.info('handlers:roster', 'User joined event', { eventId, userId })
//        logger.error('handlers:roster', err, { eventId, userId })

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./safeFile');

const LOG_DIR = path.join(DATA_DIR, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

const LEVEL_COLORS = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
};

function timestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace('Z', '');
}

function shortTime() {
  const now = new Date();
  return `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
}

function formatMessage(level, tag, message, meta = {}) {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp()} [${level.toUpperCase()}] [${tag}] ${message}${metaStr} ${shortTime()}`;
}

// Buffered file writer — batches log lines and flushes periodically
const _buffer = [];
const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER = 50;
let _flushTimer = null;

function _flush() {
  if (!_buffer.length) return;
  const date = new Date().toISOString().split('T')[0];
  const file = path.join(LOG_DIR, `${date}.log`);
  try {
    fs.appendFileSync(file, _buffer.join('\n') + '\n');
  } catch {
    // Swallow — disk full or permission issue, don't crash the bot
  }
  _buffer.length = 0;
}

function writeToFile(level, formatted) {
  _buffer.push(formatted);
  if (_buffer.length >= MAX_BUFFER) _flush();
}

function log(level, tag, message, meta = {}) {
  if (LEVELS[level] < CURRENT_LEVEL) return;
  const formatted = formatMessage(level, tag, message, meta);
  // Console with color
  const color = LEVEL_COLORS[level] || '';
  console.log(`${color}${formatted}${LEVEL_COLORS.reset}`);
  // Buffer for file
  writeToFile(level, formatted);
}

// Start periodic flush
_flushTimer = setInterval(_flush, FLUSH_INTERVAL_MS);
_flushTimer.unref?.();

// Safety nets: flush on exit / crash
process.on('exit', _flush);
process.on('uncaughtException', () => { _flush(); process.exit(1); });

function createLogger(defaultTag) {
  return {
    debug: (msg, meta) => log('debug', defaultTag, msg, meta),
    info: (msg, meta) => log('info', defaultTag, msg, meta),
    warn: (msg, meta) => log('warn', defaultTag, msg, meta),
    error: (msg, meta) => log('error', defaultTag, msg, meta),
    // Convenience for errors with stack
    err: (err, meta = {}) => {
      const { message, stack, ...rest } = err instanceof Error ? err : new Error(String(err));
      log('error', defaultTag, message, { stack, ...rest, ...meta });
    },
  };
}

module.exports = {
  LEVELS,
  createLogger,
  // Global helpers for quick one-offs without creating a logger
  debug: (tag, msg, meta) => log('debug', tag, msg, meta),
  info: (tag, msg, meta) => log('info', tag, msg, meta),
  warn: (tag, msg, meta) => log('warn', tag, msg, meta),
  error: (tag, msg, meta) => log('error', tag, msg, meta),
  err: (tag, err, meta) => {
    const { message, stack, ...rest } = err instanceof Error ? err : new Error(String(err));
    log('error', tag, message, { stack, ...rest, ...meta });
  },
};
