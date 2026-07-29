# ─── Stage 1: frontend build ─────────────────────────────────────
# Builds the Vue3 SPA (frontend-app) with vite → frontend-app/dist.
FROM node:22-alpine AS frontend
WORKDIR /build/frontend-app
COPY frontend-app/package.json frontend-app/package-lock.json ./
RUN npm ci
COPY frontend-app/ ./
RUN npm run build

# ─── Stage 2: backend build ──────────────────────────────────────
# Compiles server.ts + backend/** with tsc → dist/ (needs devDeps).
FROM node:22-alpine AS backend
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY server.ts ./
COPY backend ./backend
RUN npm run build

# ─── Stage 3: runtime ────────────────────────────────────────────
# Production deps only + compiled backend + built SPA + legacy
# frontend/ fallback (FRONTEND_DIR points at the Vue build).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    FRONTEND_DIR=frontend-app/dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=backend /build/dist ./dist
COPY --from=frontend /build/frontend-app/dist ./frontend-app/dist
COPY frontend ./frontend
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"
CMD ["node", "dist/server.js"]
