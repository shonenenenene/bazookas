# The Bazookas в контейнере: один процесс раздаёт игру (dist/), список комнат (/api/rooms) и WebSocket (/ws)
# на порту 8080. HTTPS и домен — снаружи (Nginx Proxy Manager), см. README → «Деплой».

# ─── Сборка: зависимости и клиент в dist/ (заодно проверка типов) ───
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# ─── Запуск: сервер на TypeScript через tsx (он в node_modules из сборки) ───
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/package.json /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/assets ./assets
EXPOSE 8080
USER node
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/server/main.ts"]
