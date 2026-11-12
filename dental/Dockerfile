# Plataforma odontológica — imagen de producción (Railway / cualquier host con Docker).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY server ./server
COPY web ./web
RUN npm run build

FROM node:22-slim
# Cliente de PostgreSQL 17 (repositorio oficial PGDG) para los respaldos y el simulacro (B-100):
# pg_dump debe ser de la misma versión mayor que el servidor o más nuevo (sirve para 16 y 17).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && . /etc/os-release \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
 && pg_dump --version && pg_restore --version
ENV NODE_ENV=production \
    PORT=8080 \
    DENTAL_STATIC_DIR=/app/web/dist \
    TRUST_PROXY=1 \
    DENTAL_FILES_DIR=/data/files
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/server/dist ./server/dist
COPY server/migrations ./server/migrations
COPY server/assets ./server/assets
COPY --from=build /app/web/dist ./web/dist
# Archivos clínicos: montar un volumen persistente en /data (Railway: Volumes → /data).
RUN mkdir -p /data/files && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/main.js"]
