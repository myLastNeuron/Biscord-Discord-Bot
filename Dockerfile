# Biscord — production image.
# Debian slim is used (not alpine) because the prebuilt ffmpeg/yt-dlp
# binaries target glibc, not musl.
FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

# Install dependencies first so this layer is cached when only source changes.
# --ignore-scripts skips the postinstall binary downloads; run.js's ensure-deps
# bootstrap fetches the correct yt-dlp/ffmpeg binaries for the container's
# platform on first start.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY . .

# Run as the unprivileged user that ships with the base image.
RUN chown -R node:node /app
USER node

# Runtime state (the JSON data store + logs) lives here. Mount a volume to
# persist it, e.g.  docker run -v biscord-data:/app/data ...
VOLUME ["/app/data"]

# run.js supervises the bot and self-heals the music/voice binaries.
CMD ["node", "run.js"]
