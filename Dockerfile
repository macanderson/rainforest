# syntax=docker/dockerfile:1

# Production image for the Rainforest app (issue #15, architecture.md §7).
# Builds the Next.js 16 standalone output; the SQLite database is NOT baked
# into the image — it lives on a volume mount at /var/lib/rainforest
# (§7.2) and is created/migrated on first boot by docker-entrypoint.mjs.

FROM node:22-alpine AS base

# --- Dependencies ------------------------------------------------------------
FROM base AS deps
WORKDIR /app
# better-sqlite3 ships prebuilt binaries for node 22 on linux; python3/make/g++
# are the fallback toolchain if a prebuilt is ever unavailable.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Build -------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runner ------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/var/lib/rainforest/rainforest.db

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs \
    && mkdir -p /var/lib/rainforest && chown nextjs:nodejs /var/lib/rainforest

# Next.js standalone output: server.js plus the traced node_modules subset.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Migration runner + SQL, applied by the entrypoint against the volume-mounted
# database on every boot (re-runs are no-ops via the drizzle_migrations ledger).
COPY --from=builder --chown=nextjs:nodejs /app/lib/db/migrate.mjs ./lib/db/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
# The traced node_modules land at ./node_modules; migrate.mjs must resolve
# better-sqlite3 from there, not walk up to the host filesystem. Copy the
# whole production tree (small) rather than guessing transitive deps.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs docker-entrypoint.mjs ./docker-entrypoint.mjs

USER nextjs

EXPOSE 3000

# The SQLite file lives on this volume, never in the image (§7.2).
VOLUME ["/var/lib/rainforest"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "docker-entrypoint.mjs"]
