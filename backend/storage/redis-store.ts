/**
 * backend/storage/redis-store.ts - Redis-backed Storage
 *
 * Mirrors the three in-memory Map semantics (players/rooms/games) plus
 * socket link bookkeeping into Redis as JSON documents with sliding TTLs
 * (every write refreshes the TTL). Socket links use two plain-string key
 * families for both lookup directions.
 *
 * Error policy: no silent in-memory fallback (that would split runtime
 * state across backends). Client 'error' events are logged; command
 * rejections propagate to callers, which already wrap store calls in
 * try/catch.
 *
 * Serialization: players/rooms are plain JSON round-trips. Game records
 * hold class instances (Deck, PotManager, Card) and a Set (actionsTaken),
 * so the game methods route through ./game-serializer, which revives the
 * domain objects on read — a restored game can keep being played.
 */

import type {
  PlayerRecord,
  RoomFilter,
  RoomRecord,
  GameRecord,
  Storage,
} from './memory-store';
import { serializeGame, deserializeGame } from './game-serializer';

/** Minimal Redis command surface used here (satisfied by ioredis). */
export interface RedisLike {
  set(...args: any[]): Promise<any>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  scan(cursor: string, ...args: any[]): Promise<[string, string[]]>;
  on(event: string, listener: (...args: any[]) => void): any;
  quit?(): Promise<any>;
}

/** Constructor options; `client` enables unit tests with a mock Redis. */
interface RedisStoreOptions {
  url?: string;
  client?: RedisLike;
}

/** Sliding TTLs (milliseconds) applied on every write. */
export const REDIS_TTL_MS = Object.freeze({
  player: 7 * 24 * 3600 * 1000, // 7 days
  room: 24 * 3600 * 1000,       // 24 hours
  game: 24 * 3600 * 1000,       // 24 hours
  socket: 24 * 3600 * 1000,     // 24 hours
});

/** Key conventions; scan patterns never collide across families. */
export const REDIS_KEYS = Object.freeze({
  player: (id: string) => `poker:player:${id}`,
  room: (id: string) => `poker:room:${id}`,
  game: (roomId: string) => `poker:game:${roomId}`,
  socket: (socketId: string) => `poker:socket:${socketId}`,
  socketByPlayer: (playerId: string) => `poker:socket_by_player:${playerId}`,
});

const EMPTY_ROOMS_MS = 3600000; // same idle-room rule as the memory store

export class RedisStore implements Storage {
  private client: RedisLike;

  // Compatibility shims: production code (player-manager) and tests touch
  // the memory store's maps directly. Under Redis those scans are async,
  // so the maps stay empty — the nickname fan-out fallback that walks
  // `store.rooms` degrades to a no-op (the primary currentRoom path is
  // unaffected). Documented deviation from the memory backend.
  //
  // Write-through status (P5c): room-manager and the _showdown settlement
  // persist every mutation via updateRoom()/updatePlayer(), and the game
  // entity path persists via updateGame(), so lobby flows and full hands
  // survive this backend's detached-copy reads (see
  // backend/storage/redis-room-flow.test.ts). Remaining gap: a few
  // player-manager convenience methods (setOnline/touch/disconnectPlayer/
  // updateNickname) still rely on live-object mutation for non-critical
  // fields and do not write back under this backend.
  readonly players = new Map<string, PlayerRecord>();
  readonly rooms = new Map<string, RoomRecord>();
  readonly games = new Map<string, GameRecord>();
  readonly sockets = new Map<string, string>();
  readonly playerSockets = new Map<string, string>();

  constructor(options: RedisStoreOptions = {}) {
    if (options.client) {
      this.client = options.client;
    } else {
      const { REDIS_URL } = require('../config/constants');
      if (!(options.url || REDIS_URL)) {
        throw new Error('[storage:redis] REDIS_URL is required for the redis backend');
      }
      const { Redis } = require('ioredis');
      this.client = new Redis(options.url || REDIS_URL, { maxRetriesPerRequest: 2 });
    }
    this.client.on('error', (err: Error) => {
      console.error('[storage:redis] Client error:', err);
    });
  }

  /** Disconnect (tests / graceful shutdown). */
  async close(): Promise<void> {
    if (this.client.quit) await this.client.quit();
  }

  // ─── Private helpers ─────────────────────────────────────────────
  private async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  private setJson(key: string, value: any, ttlMs: number): Promise<any> {
    return this.client.set(key, JSON.stringify(value), 'PX', ttlMs);
  }

  private setString(key: string, value: string, ttlMs: number): Promise<any> {
    return this.client.set(key, value, 'PX', ttlMs);
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }

  private async getMany<T>(keys: string[]): Promise<T[]> {
    const out: T[] = [];
    for (const key of keys) {
      const value = await this.getJson<T>(key);
      if (value !== null) out.push(value);
    }
    return out;
  }

  // ─── Players ─────────────────────────────────────────────────────
  async createPlayer(player: PlayerRecord): Promise<PlayerRecord> {
    if (!player || !player.id) {
      throw new Error('Player must have an id');
    }
    if (await this.client.get(REDIS_KEYS.player(player.id)) !== null) {
      throw new Error(`Player already exists: ${player.id}`);
    }
    await this.setJson(REDIS_KEYS.player(player.id), player, REDIS_TTL_MS.player);
    return player;
  }

  async getPlayer(id: string): Promise<PlayerRecord | null> {
    return this.getJson<PlayerRecord>(REDIS_KEYS.player(id));
  }

  async getPlayerBySocket(socketId: string): Promise<PlayerRecord | null> {
    const playerId = await this.getPlayerIdBySocket(socketId);
    return playerId ? this.getPlayer(playerId) : null;
  }

  async updatePlayer(id: string, updates: Partial<PlayerRecord>): Promise<PlayerRecord | null> {
    const player = await this.getPlayer(id);
    if (!player) return null;
    Object.assign(player, updates);
    await this.setJson(REDIS_KEYS.player(id), player, REDIS_TTL_MS.player);
    return player;
  }

  async deletePlayer(id: string): Promise<void> {
    const player = await this.getPlayer(id);
    if (player && player.socketId) {
      await this.client.del(REDIS_KEYS.socket(player.socketId));
    }
    await this.client.del(REDIS_KEYS.socketByPlayer(id), REDIS_KEYS.player(id));
  }

  async listPlayers(): Promise<PlayerRecord[]> {
    const keys = await this.scanKeys('poker:player:*');
    return this.getMany<PlayerRecord>(keys);
  }

  // ─── Sockets ─────────────────────────────────────────────────────
  async linkSocket(socketId: string, playerId: string): Promise<void> {
    // Unlink any existing socket for this player (memory-store semantics)
    const oldSocketId = await this.client.get(REDIS_KEYS.socketByPlayer(playerId));
    if (oldSocketId && oldSocketId !== socketId) {
      await this.client.del(REDIS_KEYS.socket(oldSocketId));
    }
    await this.setString(REDIS_KEYS.socket(socketId), playerId, REDIS_TTL_MS.socket);
    await this.setString(REDIS_KEYS.socketByPlayer(playerId), socketId, REDIS_TTL_MS.socket);

    const player = await this.getPlayer(playerId);
    if (player) {
      await this.updatePlayer(playerId, { socketId, isOnline: true });
    }
  }

  async unlinkSocket(socketId: string): Promise<void> {
    const playerId = await this.client.get(REDIS_KEYS.socket(socketId));
    if (!playerId) return;
    await this.client.del(REDIS_KEYS.socket(socketId), REDIS_KEYS.socketByPlayer(playerId));
    const player = await this.getPlayer(playerId);
    if (player) {
      await this.updatePlayer(playerId, { socketId: null, isOnline: false });
    }
  }

  async getPlayerIdBySocket(socketId: string): Promise<string | null> {
    return this.client.get(REDIS_KEYS.socket(socketId));
  }

  async getSocketByPlayerId(playerId: string): Promise<string | null> {
    return this.client.get(REDIS_KEYS.socketByPlayer(playerId));
  }

  // ─── Rooms ───────────────────────────────────────────────────────
  async createRoom(room: RoomRecord): Promise<RoomRecord> {
    if (!room || !room.id) {
      throw new Error('Room must have an id');
    }
    if (await this.client.get(REDIS_KEYS.room(room.id)) !== null) {
      throw new Error(`Room already exists: ${room.id}`);
    }
    await this.setJson(REDIS_KEYS.room(room.id), room, REDIS_TTL_MS.room);
    return room;
  }

  async getRoom(id: string): Promise<RoomRecord | null> {
    return this.getJson<RoomRecord>(REDIS_KEYS.room(id));
  }

  async updateRoom(id: string, updates: Partial<RoomRecord>): Promise<RoomRecord | null> {
    const room = await this.getRoom(id);
    if (!room) return null;
    Object.assign(room, updates);
    await this.setJson(REDIS_KEYS.room(id), room, REDIS_TTL_MS.room);
    return room;
  }

  async deleteRoom(id: string): Promise<void> {
    await this.client.del(REDIS_KEYS.room(id), REDIS_KEYS.game(id));
  }

  async listRooms(filter: RoomFilter = {}): Promise<RoomRecord[]> {
    const keys = await this.scanKeys('poker:room:*');
    let rooms = await this.getMany<RoomRecord>(keys);
    if (filter.status) {
      rooms = rooms.filter(r => r.status === filter.status);
    }
    if (filter.isPublic !== undefined) {
      rooms = rooms.filter(r => filter.isPublic ? !r.isPrivate : r.isPrivate);
    }
    return rooms;
  }

  // ─── Games ───────────────────────────────────────────────────────
  // Game records carry live domain objects (Deck/PotManager/Card/Set);
  // serializeGame/deserializeGame keep them functional across the
  // JSON round-trip. createGame returns the caller's live object, so the
  // engine keeps working on real instances after the write.
  async createGame(game: GameRecord): Promise<GameRecord> {
    if (!game || !game.roomId) {
      throw new Error('Game must have a roomId');
    }
    await this.setJson(REDIS_KEYS.game(game.roomId), serializeGame(game), REDIS_TTL_MS.game);
    return game;
  }

  async getGame(roomId: string): Promise<GameRecord | null> {
    const raw = await this.getJson<any>(REDIS_KEYS.game(roomId));
    return raw ? deserializeGame(raw) : null;
  }

  async updateGame(roomId: string, updates: Partial<GameRecord>): Promise<GameRecord | null> {
    const game = await this.getGame(roomId);
    if (!game) return null;
    Object.assign(game, updates);
    await this.setJson(REDIS_KEYS.game(roomId), serializeGame(game), REDIS_TTL_MS.game);
    return game;
  }

  async deleteGame(roomId: string): Promise<void> {
    await this.client.del(REDIS_KEYS.game(roomId));
  }

  // ─── Cleanup ─────────────────────────────────────────────────────
  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const room of await this.listRooms()) {
      if (Array.isArray(room.players) && room.players.length === 0 && (now - room.createdAt) > EMPTY_ROOMS_MS) {
        await this.deleteRoom(room.id);
      }
    }
  }
}
