FROM node:22-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix backend

COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "backend/server.js"]
