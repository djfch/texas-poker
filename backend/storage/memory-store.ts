/**
 * backend/storage/memory-store.ts - In-memory data storage
 *
 * Simple in-memory store for players, rooms, and games.
 * All async methods return Promises so this layer can be replaced by
 * Redis/PostgreSQL without changing callers.
 *
 * The exported `Storage` interface is the contract every store
 * implementation (memory, PostgreSQL, Redis) must satisfy.
 */

/** Player record. Only `id` is guaranteed; other fields are dynamic. */
export interface PlayerRecord {
  id: string;
  [key: string]: any;
}

/** Room record. Only `id` is guaranteed; other fields are dynamic. */
export interface RoomRecord {
  id: string;
  [key: string]: any;
}

/** Game record. Only `roomId` is guaranteed; other fields are dynamic. */
export interface GameRecord {
  roomId: string;
  [key: string]: any;
}

/** Optional filter accepted by listRooms(). */
export interface RoomFilter {
  status?: string;
  isPublic?: boolean;
}

/**
 * One settled-hand history row, written per player at showdown by stores
 * that implement the optional saveHandHistory() method (e.g. PostgreSQL).
 */
export interface HandHistoryEntry {
  roomId: string;
  /** Games are keyed by roomId in the current engine, so gameId === roomId. */
  gameId: string;
  playerId: string;
  nickname?: string;
  /** Stringified hole cards, e.g. ['A♥', 'K♦']; null when unknown. */
  holeCards: string[] | null;
  /** Human-readable hand name at showdown; null for folded/unevaluated. */
  handName: string | null;
  /** Chip delta from the start of the hand (positive = won). */
  delta: number;
  startingChips: number;
  finalChips: number;
  isWinner: boolean;
  /** Free-form context (community cards, pot, seat, folded flag, ...). */
  summary: Record<string, any>;
  /** Milliseconds epoch, consistent with PlayerRecord.createdAt. */
  createdAt: number;
}

/**
 * Storage contract shared by all store implementations.
 * players / rooms / games CRUD plus socket link bookkeeping,
 * every method async so callers stay unchanged when the backend
 * store is swapped for Redis/PostgreSQL.
 */
export interface Storage {
  // ─── Players ───────────────────────────────────────────────────
  createPlayer(player: PlayerRecord): Promise<PlayerRecord>;
  getPlayer(id: string): Promise<PlayerRecord | null>;
  getPlayerBySocket(socketId: string): Promise<PlayerRecord | null>;
  updatePlayer(id: string, updates: Partial<PlayerRecord>): Promise<PlayerRecord | null>;
  deletePlayer(id: string): Promise<void>;
  listPlayers(): Promise<PlayerRecord[]>;

  // ─── Sockets ───────────────────────────────────────────────────
  linkSocket(socketId: string, playerId: string): Promise<void>;
  unlinkSocket(socketId: string): Promise<void>;
  getPlayerIdBySocket(socketId: string): Promise<string | null>;
  getSocketByPlayerId(playerId: string): Promise<string | null>;

  // ─── Rooms ─────────────────────────────────────────────────────
  createRoom(room: RoomRecord): Promise<RoomRecord>;
  getRoom(id: string): Promise<RoomRecord | null>;
  updateRoom(id: string, updates: Partial<RoomRecord>): Promise<RoomRecord | null>;
  deleteRoom(id: string): Promise<void>;
  listRooms(filter?: RoomFilter): Promise<RoomRecord[]>;

  // ─── Games ─────────────────────────────────────────────────────
  createGame(game: GameRecord): Promise<GameRecord>;
  getGame(roomId: string): Promise<GameRecord | null>;
  updateGame(roomId: string, updates: Partial<GameRecord>): Promise<GameRecord | null>;
  deleteGame(roomId: string): Promise<void>;

  // ─── Cleanup ───────────────────────────────────────────────────
  cleanup(): Promise<void>;

  // ─── Optional extensions ─────────────────────────────────────────
  /**
   * Optional: persist one settled-hand history row. Only stores with a
   * durable history backend (PostgreSQL) implement this; the game engine
   * probes for the method and skips it otherwise. Implementations must
   * let errors propagate — the engine catches and logs them.
   */
  saveHandHistory?(entry: HandHistoryEntry): Promise<void>;
}

// Export the store singleton exactly like the former .js module did, but let
// the storage factory choose the implementation from STORE_BACKEND. Requiring
// the factory here keeps every existing caller
// (`require('../storage/memory-store')`) working unchanged. The MemoryStore
// class itself lives in ./memory-impl to keep this module cycle-free.
// NOTE: `export =` cannot be used here because tsx/esbuild miscompiles the
// combination of type-only exports (the Storage interface above) with an
// export assignment; a plain `module.exports =` statement is runtime-safe.
module.exports = require('./index');
