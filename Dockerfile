# Photo portfolio: watches /photos, builds the static site into /data, serves it on 8080.

FROM node:26-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:26-slim
ENV NODE_ENV=production \
    PHOTOS_DIR=/photos \
    DATA_DIR=/data \
    ASTRO_CACHE_DIR=/data/.cache \
    ASTRO_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    SITE_URL=https://photo.mugetsu.xyz
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json astro.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
COPY server ./server
COPY scripts ./scripts

# Astro writes generated types to /app/.astro on each build. Make it writable for any
# user, so the container also runs as TrueNAS's "apps" user (568) or any other uid.
RUN mkdir -p /app/.astro /photos /data \
 && chmod 1777 /app/.astro \
 && chown node:node /data

USER node
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server/index.ts"]
