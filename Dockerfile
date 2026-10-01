# --- Stage 1: Build Phase ---
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build tools) from
# the lockfile — the `|| npm install` fallback masked lockfile drift and
# silently resolved semver ranges instead (non-reproducible builds).
RUN npm ci

# Copy source code files (.dockerignore keeps vault data/secrets out)
COPY . .

# Build the frontend (Vite static files) and bundle the server (esbuild)
RUN npm run build

# --- Stage 2: Production Runtime ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy built artifacts, lockfile, and the bilingual dictionaries the server
# loads (previously missing — every dictionary engine silently loaded as null
# inside the container).
COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dictionaries ./dictionaries
COPY --from=builder /app/shared ./shared

# Install production-only dependencies from the lockfile, drop npm cache
RUN npm ci --omit=dev && npm cache clean --force

# Don't run as root; pre-create the vault dir with node ownership (bind/named
# volumes inherit this on first mount).
RUN mkdir -p /app/data && chown -R node:node /app/data /app
USER node

# Expose port 3000 (IndexArc defaults)
EXPOSE 3000

# Set portable environment directories. VOLUME keeps vault data across
# container recreation (without it, a recreated container lost the vault).
ENV INDEXARC_ROOT=/app/data
ENV INDEXARC_DIST_DIR=/app/dist
VOLUME /app/data

# Run node directly — npm as PID 1 does not forward SIGTERM, so `docker stop`
# never gracefully shut the server down (and skipped its exit-time flushes).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/ping >/dev/null || exit 1
CMD ["node", "dist/server.cjs"]
