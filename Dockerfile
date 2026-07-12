# syntax=docker/dockerfile:1

# ============================================================================
# Stage 1 — Build the SvelteKit client (static SPA)
# ============================================================================
FROM node:22-bookworm-slim AS client-build
WORKDIR /build/client

# Install client deps (cached layer)
COPY client/package.json client/package-lock.json* ./
RUN npm ci

# Build the client
COPY client/ ./
RUN npm run build

# ============================================================================
# Stage 2 — Build the TypeScript server
# ============================================================================
FROM node:22-bookworm-slim AS server-build
WORKDIR /build/server

COPY server/package.json server/package-lock.json* ./
RUN npm ci

COPY server/ ./
RUN npm run build

# Prune dev dependencies so the runtime image only keeps what it needs.
RUN npm prune --omit=dev

# ============================================================================
# Stage 3 — Runtime image: Node + git + built app
# ============================================================================
FROM node:22-bookworm-slim AS runtime

# git is required for git-http-backend (push/pull/clone) and repo init.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the built server and its production dependencies.
COPY --from=server-build /build/server/package.json ./
COPY --from=server-build /build/server/node_modules ./node_modules
COPY --from=server-build /build/server/dist ./dist

# Copy the built client so the server can serve it from a single port.
COPY --from=client-build /build/client/build ./public

# Data volume: bare repos + SQLite DB live here.
RUN mkdir -p /data
VOLUME ["/data"]

ENV NODE_ENV=production
ENV PORT=3000
ENV NASHGIT_DATA_DIR=/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
