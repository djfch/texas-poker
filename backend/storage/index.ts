/**
 * backend/storage/index.ts - Storage factory
 *
 * Assembles the Storage implementation selected by STORE_BACKEND:
 *   - 'memory'   (default): in-process MemoryStore, no external services
 *   - 'postgres': PostgreSQL users + hand history, runtime state in memory
 *   - 'redis':    players/rooms/games + socket links in Redis
 *
 * The chosen singleton is exported with the exact same shape the old
 * memory-store module had (`module.exports = store`), and memory-store.ts
 * re-exports it, so every existing caller keeps working unchanged.
 * Backend-specific modules are required lazily so the default memory mode
 * never loads the pg/ioredis drivers.
 */

import type { Storage } from './memory-store';

const { STORE_BACKEND } = require('../config/constants');

function createStore(): Storage {
  switch (String(STORE_BACKEND || 'memory').toLowerCase()) {
    case 'memory': {
      const { MemoryStore } = require('./memory-impl');
      return new MemoryStore();
    }
    case 'postgres':
    case 'pg': {
      const { PostgresStore } = require('./postgres-store');
      return new PostgresStore();
    }
    case 'redis': {
      const { RedisStore } = require('./redis-store');
      return new RedisStore();
    }
    default:
      throw new Error(
        `[storage] Unknown STORE_BACKEND "${STORE_BACKEND}". ` +
        'Expected one of: memory, postgres, redis.'
      );
  }
}

module.exports = createStore();
