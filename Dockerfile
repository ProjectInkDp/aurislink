# Stage 1: Builder
FROM node:20-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

COPY package.json ./
RUN npm install

# Stage 2: Runner
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules

COPY src/ ./src/
COPY config.default.ts ./config.default.ts
COPY package.json ./package.json
COPY tsconfig.json ./tsconfig.json

EXPOSE 2333

ENV AURIS_SERVER_PORT=2333 \
    AURIS_SERVER_HOST=0.0.0.0

CMD ["npm", "start"]
