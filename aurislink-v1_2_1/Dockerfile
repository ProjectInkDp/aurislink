FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production

EXPOSE 2333

CMD ["node", "--dns-result-order=ipv4first", "dist/src/index.js"]
