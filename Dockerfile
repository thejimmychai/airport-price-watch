FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    python3-minimal \
    python3-pil \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
