FROM node:20-alpine

WORKDIR /app

# Copy dependency files first for better layer caching
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY server.js ./
COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
