# Gabriel Store — imagen para publicar (Render, Railway, VPS).
# Los datos (base SQLite, comprobantes, respaldos) van en /data: montá ahí un disco/volumen.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    GS_DATA_DIR=/data \
    GS_STATIC_DIR=/app/public \
    GS_TRUST_PROXY=1
WORKDIR /app
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/main.js"]
