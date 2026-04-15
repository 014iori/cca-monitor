FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

# Persist seen-auctions.json across restarts via a volume
VOLUME ["/app/data"]
ENV STORAGE_PATH=/app/data/seen-auctions.json

CMD ["node", "dist/index.js"]
