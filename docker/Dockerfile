# syntax=docker/dockerfile:1.7
# Multi-stage build: one image serves both `web` (Next.js standalone) and `worker` (BullMQ).

FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat wget
WORKDIR /app

# --- deps -------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- prod-deps (runtime node_modules for the worker, no dev deps) ------
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- build ------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders: `next build` imports server modules (auth, db client) which read the
# environment at module load. Real values are injected by Coolify at runtime; nothing here is baked
# into the bundle (only NEXT_PUBLIC_* variables would be).
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    APP_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime \
    APP_ENCRYPTION_KEY=build-time-placeholder-not-used-at-runtime \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    REDIS_URL=redis://localhost:6379
RUN npm run build && npm run worker:build

# --- runner -----------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Next.js standalone server (+ static assets and public dir)
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Worker bundle + everything it needs at runtime (external packages come from node_modules)
COPY --from=build --chown=nextjs:nodejs /app/dist ./dist
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/package.json ./package.json

# Migrations + scripts
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh && mkdir -p /data/uploads && chown -R nextjs:nodejs /data

USER nextjs
EXPOSE 3000
CMD ["/app/docker/entrypoint.sh", "web"]
