FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

ENV STORAGE_PATH=/app/data/seen-auctions.json

CMD ["node", "dist/index.js"]
