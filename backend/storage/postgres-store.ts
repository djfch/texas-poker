/**
 * backend/storage/postgres-store.ts - PostgreSQL-backed Storage
 *
 * Composition design: durable player profiles (users table) and settled
 * hand history (hand_history table) live in PostgreSQL, while rooms,
 * games and socket links — high-churn ephemeral runtime state — stay in
 * a composed in-memory MemoryStore instance (`this.runtime`). This keeps
 * the full Storage contract satisfied without pushing per-action game
 * state into SQL. PlayerManager's direct `store.rooms` map access keeps
 * working because the runtime maps are exposed as pass-through getters.
 *
 * Schema notes: account-facing PlayerRecord fields map to fixed columns;
 * every remaining dynamic field round-trips through the `data` JSONB
 * column. Epoch timestamps stay BIGINT milliseconds, identical to the
 * in-memory record shape.
 */

import type {
  HandHistoryEntry,
  PlayerRecord,
  RoomFilter,
  RoomRecord,
  GameRecord,
  Storage,
} from './memory-store';
import type { PgQueryable } from './pg-client';

/** Minimal client contract: queryable plus one-shot schema migration. */
export interface PgStoreClient extends PgQueryable {
  migrate(): Promise<void>;
  close?(): Promise<void>;
}

/** Constructor options; `client` enables unit tests with a mock pool. */
interface PostgresStoreOptions {
  url?: string;
  client?: PgStoreClient;
}

/** PlayerRecord keys persisted as fixed columns (rest goes to `data`). */
const FIXED_FIELDS = ['username', 'passwordHash', 'nickname', 'avatar', 'chips', 'createdAt'] as const;

/** Split a PlayerRecord into fixed column values + dynamic JSONB data. */
function splitPlayer(player: PlayerRecord): { cols: any[]; data: Record<string, any> } {
  const data: Record<string, any> = {};
  for (const [key, value] of Object.entries(player)) {
    if (key !== 'id' && !(FIXED_FIELDS as readonly string[]).includes(key)) {
      data[key] = value;
    }
  }
  return {
    cols: [
      player.id,
      player.username ?? null,
      player.passwordHash ?? null,
      player.nickname ?? null,
      player.avatar ?? null,
      player.chips ?? 0,
      player.createdAt ?? Date.now(),
    ],
    data,
  };
}

/** Rebuild the full PlayerRecord from a users row (data JSONB merged). */
function rowToPlayer(row: any): PlayerRecord {
  return {
    ...(row.data || {}),
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash ?? null,
    nickname: row.nickname,
    avatar: row.avatar,
    chips: Number(row.chips),
    createdAt: Number(row.created_at),
  };
}

export class PostgresStore implements Storage {
  private client: PgStoreClient;
  private initPromise: Promise<void> | null = null;

  // Runtime state lives in a composed MemoryStore (from ./memory-impl, a
  // cycle-free module) — rooms/games/socket links stay ephemeral.
  private runtime: import('./memory-impl').MemoryStore;

  constructor(options: PostgresStoreOptions = {}) {
    if (options.client) {
      this.client = options.client;
    } else {
      const { DATABASE_URL } = require('../config/constants');
      const { PgClient } = require('./pg-client');
      this.client = new PgClient(options.url || DATABASE_URL);
    }
    const { MemoryStore } = require('./memory-impl');
    this.runtime = new MemoryStore();
  }

  // ─── MemoryStore map pass-throughs (compatibility shims) ─────────
  get players() { return this.runtime.players; }
  get rooms() { return this.runtime.rooms; }
  get games() { return this.runtime.games; }
  get sockets() { return this.runtime.sockets; }
  get playerSockets() { return this.runtime.playerSockets; }

  /** Run pending migrations exactly once, lazily on first use. */
  private ready(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.client.migrate();
    }
    return this.initPromise;
  }

  /** Release the pool (tests / graceful shutdown). */
  async close(): Promise<void> {
    if (this.client.close) await this.client.close();
  }

  // ─── Players (SQL) ───────────────────────────────────────────────
  async createPlayer(player: PlayerRecord): Promise<PlayerRecord> {
    if (!player || !player.id) {
      throw new Error('Player must have an id');
    }
    await this.ready();
    const existing = await this.client.query('SELECT 1 AS x FROM users WHERE id = $1', [player.id]);
    if (existing.rowCount && existing.rowCount > 0) {
      throw new Error(`Player already exists: ${player.id}`);
    }
    const { cols, data } = splitPlayer(player);
    await this.client.query(
      `INSERT INTO users (id, username, password_hash, nickname, avatar, chips, created_at, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [...cols, data]
    );
    return player;
  }

  async getPlayer(id: string): Promise<PlayerRecord | null> {
    await this.ready();
    const result = await this.client.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows.length ? rowToPlayer(result.rows[0]) : null;
  }

  async getPlayerBySocket(socketId: string): Promise<PlayerRecord | null> {
    const playerId = await this.runtime.getPlayerIdBySocket(socketId);
    return playerId ? this.getPlayer(playerId) : null;
  }

  async updatePlayer(id: string, updates: Partial<PlayerRecord>): Promise<PlayerRecord | null> {
    const existing = await this.getPlayer(id);
    if (!existing) return null;
    const merged: PlayerRecord = { ...existing, ...updates, id };
    const { cols, data } = splitPlayer(merged);
    await this.client.query(
      `UPDATE users
       SET username = $2, password_hash = $3, nickname = $4, avatar = $5,
           chips = $6, created_at = $7, data = $8
       WHERE id = $1`,
      [...cols, data]
    );
    return merged;
  }

  async deletePlayer(id: string): Promise<void> {
    const player = await this.getPlayer(id);
    if (player && player.socketId) {
      await this.runtime.unlinkSocket(player.socketId);
    }
    await this.runtime.deletePlayer(id);
    await this.ready();
    await this.client.query('DELETE FROM users WHERE id = $1', [id]);
  }

  async listPlayers(): Promise<PlayerRecord[]> {
    await this.ready();
    const result = await this.client.query('SELECT * FROM users');
    return result.rows.map(rowToPlayer);
  }

  // ─── Sockets (runtime memory + player field sync to SQL) ─────────
  async linkSocket(socketId: string, playerId: string): Promise<void> {
    await this.runtime.linkSocket(socketId, playerId);
    if (await this.getPlayer(playerId)) {
      await this.updatePlayer(playerId, { socketId, isOnline: true });
    }
  }

  async unlinkSocket(socketId: string): Promise<void> {
    const playerId = await this.runtime.getPlayerIdBySocket(socketId);
    await this.runtime.unlinkSocket(socketId);
    if (playerId && (await this.getPlayer(playerId))) {
      await this.updatePlayer(playerId, { socketId: null, isOnline: false });
    }
  }

  async getPlayerIdBySocket(socketId: string): Promise<string | null> {
    return this.runtime.getPlayerIdBySocket(socketId);
  }

  async getSocketByPlayerId(playerId: string): Promise<string | null> {
    return this.runtime.getSocketByPlayerId(playerId);
  }

  // ─── Rooms (runtime memory) ──────────────────────────────────────
  async createRoom(room: RoomRecord): Promise<RoomRecord> {
    return this.runtime.createRoom(room);
  }

  async getRoom(id: string): Promise<RoomRecord | null> {
    return this.runtime.getRoom(id);
  }

  async updateRoom(id: string, updates: Partial<RoomRecord>): Promise<RoomRecord | null> {
    return this.runtime.updateRoom(id, updates);
  }

  async deleteRoom(id: string): Promise<void> {
    return this.runtime.deleteRoom(id);
  }

  async listRooms(filter: RoomFilter = {}): Promise<RoomRecord[]> {
    return this.runtime.listRooms(filter);
  }

  // ─── Games (runtime memory) ──────────────────────────────────────
  async createGame(game: GameRecord): Promise<GameRecord> {
    return this.runtime.createGame(game);
  }

  async getGame(roomId: string): Promise<GameRecord | null> {
    return this.runtime.getGame(roomId);
  }

  async updateGame(roomId: string, updates: Partial<GameRecord>): Promise<GameRecord | null> {
    return this.runtime.updateGame(roomId, updates);
  }

  async deleteGame(roomId: string): Promise<void> {
    return this.runtime.deleteGame(roomId);
  }

  // ─── Cleanup (runtime memory) ────────────────────────────────────
  async cleanup(): Promise<void> {
    return this.runtime.cleanup();
  }

  // ─── Hand history (SQL) ──────────────────────────────────────────
  async saveHandHistory(entry: HandHistoryEntry): Promise<void> {
    await this.ready();
    await this.client.query(
      `INSERT INTO hand_history
         (room_id, game_id, player_id, nickname, hole_cards, hand_name,
          delta, starting_chips, final_chips, is_winner, summary, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        entry.roomId,
        entry.gameId,
        entry.playerId,
        entry.nickname ?? null,
        entry.holeCards ? JSON.stringify(entry.holeCards) : null,
        entry.handName ?? null,
        entry.delta,
        entry.startingChips,
        entry.finalChips,
        entry.isWinner,
        entry.summary || {},
        entry.createdAt,
      ]
    );
  }
}
