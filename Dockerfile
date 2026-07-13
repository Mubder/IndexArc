# --- Stage 1: Build Phase ---
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build tools)
RUN npm ci || npm install

# Copy source code files
COPY . .

# Build the frontend (Vite static files) and bundle the server (esbuild)
RUN npm run build

# --- Stage 2: Production Runtime ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy built artifacts and configuration
COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist ./dist

# Install production-only dependencies to minimize image size
RUN npm install --omit=dev

# Expose port 3000 (IndexArc defaults)
EXPOSE 3000

# Set portable environment directories
ENV INDEXARC_ROOT=/app/data
ENV INDEXARC_DIST_DIR=/app/dist

# Define launch command
CMD ["npm", "run", "start"]
