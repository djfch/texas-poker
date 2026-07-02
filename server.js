/**
 * server.js - Texas Hold'em Poker Server Entry Point
 * 
 * Initializes Express HTTP server + Socket.IO for real-time communication.
 * Serves static frontend files from /frontend.
 * 
 * Architecture: Server-Authoritative - all game logic runs on server.
 */

require('dotenv/config');

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

const { getConfig } = require('./backend/config/constants');
const { buildHelmetOptions } = require('./backend/config/security');

// ─── Routes & Socket Handlers ────────────────────────────────────
const authRoutes = require('./backend/routes/auth');
const roomRoutes = require('./backend/routes/rooms');
const { setupSocketHandlers } = require('./backend/socket/handlers');

// ─── Configuration ───────────────────────────────────────────────
const config = getConfig();
const PORT = config.PORT;
const HOST = config.HOST;

// ─── Express App ─────────────────────────────────────────────────
const app = express();
app.use(helmet(buildHelmetOptions()));
app.use(cors({
  origin: config.CORS_ORIGINS.length ? config.CORS_ORIGINS : '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan(config.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Rate Limiting ───────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ success: false, error: 'Too many requests, please slow down' });
  },
});
app.use('/api/', limiter);

// ─── Static Files (Frontend) ─────────────────────────────────────
app.use(express.static(path.join(__dirname, 'frontend'), {
  maxAge: config.NODE_ENV === 'production' ? '1d' : 0,
  etag: config.NODE_ENV === 'production',
  lastModified: config.NODE_ENV === 'production',
  setHeaders: (res, filePath) => {
    if (config.NODE_ENV !== 'production') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }

    if (filePath.endsWith('.js') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// ─── Health Check ────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ─── REST API Routes ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);

// ─── SPA Fallback ────────────────────────────────────────────────
// Serve index.html for any non-API route to support frontend routing
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ─── HTTP Server + Socket.IO ─────────────────────────────────────
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: config.CORS_ORIGINS.length ? config.CORS_ORIGINS : '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ─── Setup Socket.IO Handlers ────────────────────────────────────
setupSocketHandlers(io);

// ─── Start Server ────────────────────────────────────────────────
httpServer.listen(PORT, HOST, () => {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║     🃏 Texas Hold\'em Poker Server                      ║');
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║  HTTP:  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}              ║`);
  console.log(`║  WS:    ws://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}               ║`);
  console.log('║  Press Ctrl+C to stop                                ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
});

// ─── Global Error Handling ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ─── Graceful Shutdown ───────────────────────────────────────────
function shutdown(signal) {
  console.log(`[Server] ${signal} received, shutting down gracefully...`);
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason);
});

// Export for testing / external imports
module.exports = { app, io, httpServer };
