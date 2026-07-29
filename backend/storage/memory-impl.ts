/**
 * backend/storage/memory-impl.ts - In-memory Storage implementation
 *
 * The concrete MemoryStore class backing the default 'memory' backend.
 * Lives in its own module (separate from memory-store.ts, whose exports
 * get replaced by the factory singleton at load time) so the factory and
 * the PostgreSQL store can construct instances in any require order
 * without circular-dependency hazards. Only type imports are used, so
 * this module has zero runtime dependencies.
 */

import type {
  GameRecord,
  PlayerRecord,
  RoomFilter,
  RoomRecord,
  Storage,
} from './memory-store';

export class MemoryStore implements Storage {
  players: Map<string, PlayerRecord>;       // playerId -> player object
  rooms: Map<string, RoomRecord>;           // roomId -> room object
  games: Map<string, GameRecord>;           // roomId -> game object
  sockets: Map<string, string>;             // socketId -> playerId
  playerSockets: Map<string, string>;       // playerId -> socketId

  constructor() {
    this.players = new Map();
    this.rooms = new Map();
    this.games = new Map();
    this.sockets = new Map();
    this.playerSockets = new Map();
  }

  // ─── Players ───────────────────────────────────────────────────
  async createPlayer(player: PlayerRecord): Promise<PlayerRecord> {
    if (!player || !player.id) {
      throw new Error('Player must have an id');
    }
    if (this.players.has(player.id)) {
      throw new Error(`Player already exists: ${player.id}`);
    }
    this.players.set(player.id, player);
    return player;
  }

  async getPlayer(id: string): Promise<PlayerRecord | null> {
    return this.players.get(id) || null;
  }

  async getPlayerBySocket(socketId: string): Promise<PlayerRecord | null> {
    const playerId = this.sockets.get(socketId);
    if (!playerId) return null;
    return this.players.get(playerId) || null;
  }

  async updatePlayer(id: string, updates: Partial<PlayerRecord>): Promise<PlayerRecord | null> {
    const player = this.players.get(id);
    if (!player) return null;
    Object.assign(player, updates);
    return player;
  }

  async deletePlayer(id: string): Promise<void> {
    const player = this.players.get(id);
    if (player && player.socketId) {
      this.sockets.delete(player.socketId);
    }
    this.playerSockets.delete(id);
    this.players.delete(id);
  }

  async listPlayers(): Promise<PlayerRecord[]> {
    return Array.from(this.players.values());
  }

  // ─── Sockets ───────────────────────────────────────────────────
  async linkSocket(socketId: string, playerId: string): Promise<void> {
    // Unlink any existing socket for this player
    const oldSocketId = this.playerSockets.get(playerId);
    if (oldSocketId && oldSocketId !== socketId) {
      this.sockets.delete(oldSocketId);
    }
    this.sockets.set(socketId, playerId);
    this.playerSockets.set(playerId, socketId);

    const player = this.players.get(playerId);
    if (player) {
      player.socketId = socketId;
      player.isOnline = true;
    }
  }

  async unlinkSocket(socketId: string): Promise<void> {
    const playerId = this.sockets.get(socketId);
    if (playerId) {
      this.sockets.delete(socketId);
      this.playerSockets.delete(playerId);
      const player = this.players.get(playerId);
      if (player) {
        player.socketId = null;
        player.isOnline = false;
      }
    }
  }

  async getPlayerIdBySocket(socketId: string): Promise<string | null> {
    return this.sockets.get(socketId) || null;
  }

  async getSocketByPlayerId(playerId: string): Promise<string | null> {
    return this.playerSockets.get(playerId) || null;
  }

  // ─── Rooms ─────────────────────────────────────────────────────
  async createRoom(room: RoomRecord): Promise<RoomRecord> {
    if (!room || !room.id) {
      throw new Error('Room must have an id');
    }
    if (this.rooms.has(room.id)) {
      throw new Error(`Room already exists: ${room.id}`);
    }
    this.rooms.set(room.id, room);
    return room;
  }

  async getRoom(id: string): Promise<RoomRecord | null> {
    return this.rooms.get(id) || null;
  }

  async updateRoom(id: string, updates: Partial<RoomRecord>): Promise<RoomRecord | null> {
    const room = this.rooms.get(id);
    if (!room) return null;
    Object.assign(room, updates);
    return room;
  }

  async deleteRoom(id: string): Promise<void> {
    this.rooms.delete(id);
    this.games.delete(id);
  }

  async listRooms(filter: RoomFilter = {}): Promise<RoomRecord[]> {
    let rooms = Array.from(this.rooms.values());
    if (filter.status) {
      rooms = rooms.filter(r => r.status === filter.status);
    }
    if (filter.isPublic !== undefined) {
      rooms = rooms.filter(r => filter.isPublic ? !r.isPrivate : r.isPrivate);
    }
    return rooms;
  }

  // ─── Games ─────────────────────────────────────────────────────
  async createGame(game: GameRecord): Promise<GameRecord> {
    if (!game || !game.roomId) {
      throw new Error('Game must have a roomId');
    }
    this.games.set(game.roomId, game);
    return game;
  }

  async getGame(roomId: string): Promise<GameRecord | null> {
    return this.games.get(roomId) || null;
  }

  async updateGame(roomId: string, updates: Partial<GameRecord>): Promise<GameRecord | null> {
    const game = this.games.get(roomId);
    if (!game) return null;
    Object.assign(game, updates);
    return game;
  }

  async deleteGame(roomId: string): Promise<void> {
    this.games.delete(roomId);
  }

  // ─── Cleanup ───────────────────────────────────────────────────
  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (room.players.length === 0 && (now - room.createdAt) > 3600000) {
        await this.deleteRoom(id);
      }
    }
  }
}
