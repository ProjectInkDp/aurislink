FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production

EXPOSE 2333

# Liveness check — hits /v4/health every 30s.
# Fails if AurisLink doesn't respond within 5s or returns a non-2xx status.
# Docker will restart the container after 3 consecutive failures.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:2333/v4/health || exit 1

CMD ["node", "--dns-result-order=ipv4first", "dist/src/index.js"]
