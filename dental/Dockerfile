# Plataforma odontológica — imagen de producción (Railway / cualquier host con Docker).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY server ./server
COPY web ./web
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DENTAL_STATIC_DIR=/app/web/dist \
    TRUST_PROXY=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/server/dist ./server/dist
COPY server/migrations ./server/migrations
COPY --from=build /app/web/dist ./web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/main.js"]
