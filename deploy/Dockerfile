# Образ сервера для боевого VPS. Статику раздаёт nginx, в образе только папка server/.
FROM node:22-slim
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/ ./
ENV NODE_ENV=production
USER node
CMD ["node", "src/server.js"]
