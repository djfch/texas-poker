/**
 * server.ts - Texas Hold'em Poker Server Entry Point
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
  handler: (req: any, res: any) => {
    res.status(429).json({ success: false, error: 'Too many requests, please slow down' });
  },
});
app.use('/api/', limiter);

// ─── Static Files (Frontend) ─────────────────────────────────────
// Resolved against the process working directory so the same relative
// path works for `tsx server.ts` (root), `node dist/server.js` (root)
// and the Docker runtime (WORKDIR /app with FRONTEND_DIR set).
const frontendDir = path.resolve(config.FRONTEND_DIR);
app.use(express.static(frontendDir, {
  maxAge: config.NODE_ENV === 'production' ? '1d' : 0,
  etag: config.NODE_ENV === 'production',
  lastModified: config.NODE_ENV === 'production',
  setHeaders: (res: any, filePath: string) => {
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
app.get('/health', (req: any, res: any) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ─── REST API Routes ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);

// ─── SPA Fallback ────────────────────────────────────────────────
// Serve index.html for any non-API route to support frontend routing
app.get('*', (req: any, res: any) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  res.sendFile(path.join(frontendDir, 'index.html'));
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

// ─── Multi-instance wiring (P5a) ─────────────────────────────────
// When REDIS_URL is configured the server runs in multi-instance mode:
// the Socket.IO redis adapter propagates room broadcasts across
// instances, and room-level scheduler ownership (turn timers / AI
// decisions) is arbitrated through Redis locks. Misconfiguration fails
// fast: a multi-instance deployment must never silently degrade into
// split-brain single-instance behaviour.
const redisClients: any[] = [];

// One labelled error listener per client: keeps ioredis from dumping
// "Unhandled error event" stacks during the startup retry window.
function makeRedisClient(label: string): any {
  const { Redis } = require('ioredis');
  // Retry policy splits startup from runtime:
  //  - before the first successful connect, give up after a few quick
  //    retries so a misconfigured REDIS_URL fails the boot fast;
  //  - after the first connect, retry forever with a capped backoff — a
  //    mid-run Redis outage must never permanently split the cluster
  //    into degenerate single instances (commands error loudly instead).
  let readyOnce = false;
  const client = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    retryStrategy: (times: number) => {
      if (!readyOnce && times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });
  client.on('ready', () => {
    readyOnce = true;
  });
  client.on('error', (err: Error) => {
    console.error(`[Server] Redis ${label} error: ${err.message}`);
  });
  redisClients.push(client);
  return client;
}

async function attachRedisAdapter(): Promise<void> {
  const { createAdapter } = require('@socket.io/redis-adapter');
  const pubClient = makeRedisClient('adapter-pub');
  const subClient = pubClient.duplicate();
  subClient.on('error', (err: Error) => {
    console.error(`[Server] Redis adapter-sub error: ${err.message}`);
  });
  redisClients.push(subClient);
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  console.log('[Server] Socket.IO redis adapter attached (multi-instance mode)');
}

async function createSchedulerOwner(): Promise<any> {
  const { SchedulerOwner } = require('./backend/socket/scheduler-owner');
  const commandClient = makeRedisClient('scheduler');
  const subscriber = commandClient.duplicate();
  subscriber.on('error', (err: Error) => {
    console.error(`[Server] Redis scheduler-sub error: ${err.message}`);
  });
  redisClients.push(subscriber);
  await Promise.all([commandClient.connect(), subscriber.connect()]);
  const scheduler = new SchedulerOwner({ client: commandClient, subscriber });
  await scheduler.start();
  console.log(`[Server] Scheduler ownership enabled (instance ${scheduler.instanceId})`);
  return scheduler;
}

async function start(): Promise<void> {
  let scheduler: any = null;
  if (config.REDIS_URL) {
    // Multi-instance mode shares room/game state through the redis store.
    // Any other STORE_BACKEND would give every instance private state
    // while the scheduler arbitrates timers cluster-wide — a silent
    // split brain. Refuse the combination outright.
    if (String(config.STORE_BACKEND).toLowerCase() !== 'redis') {
      console.error(
        `[Server] REDIS_URL requires STORE_BACKEND=redis (current: "${config.STORE_BACKEND}"). ` +
        'Multi-instance mode shares room/game state through the redis store; ' +
        'any other backend gives every instance private state (split brain). Refusing to start.'
      );
      process.exit(1);
    }
    try {
      await attachRedisAdapter();
      scheduler = await createSchedulerOwner();
    } catch (err) {
      console.error(
        '[Server] REDIS_URL is set but Redis is unreachable; refusing to start. ' +
        'Fix the configuration or unset REDIS_URL — a multi-instance deployment ' +
        'must not silently degrade to single-instance mode.',
        err
      );
      process.exit(1);
    }
  }

  // ─── Setup Socket.IO Handlers ────────────────────────────────────
  setupSocketHandlers(io, { scheduler });

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
}

start().catch(err => {
  console.error('[Server] Startup failed:', err);
  process.exit(1);
});

// ─── Global Error Handling ───────────────────────────────────────
app.use((err: any, req: any, res: any, next: any) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ─── Graceful Shutdown ───────────────────────────────────────────
function shutdown(signal: string): void {
  console.log(`[Server] ${signal} received, shutting down gracefully...`);
  io.close(() => {
    // Close any multi-instance Redis clients before releasing the port.
    Promise.all(redisClients.map(client => client.quit().catch(() => {})))
      .finally(() => {
        httpServer.close(() => process.exit(0));
      });
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

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
