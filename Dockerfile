FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

ENV STORAGE_PATH=/app/data/seen-auctions.json

CMD ["node", "dist/index.js"]
