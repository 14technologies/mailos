FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY src ./src
USER node
EXPOSE 1110 1587 1995 1465
CMD ["node", "src/index.js"]
