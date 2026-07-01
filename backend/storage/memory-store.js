/**
 * backend/storage/memory-store.js - In-memory data storage
 *
 * Simple in-memory store for players, rooms, and games.
 * All async methods return Promises so this layer can be replaced by
 * Redis/PostgreSQL without changing callers.
 */

class MemoryStore {
  constructor() {
    this.players = new Map();       // playerId -> player object
    this.rooms = new Map();         // roomId -> room object
    this.games = new Map();         // roomId -> game object
    this.sockets = new Map();       // socketId -> playerId
    this.playerSockets = new Map(); // playerId -> socketId
  }

  // ─── Players ───────────────────────────────────────────────────
  async createPlayer(player) {
    if (!player || !player.id) {
      throw new Error('Player must have an id');
    }
    if (this.players.has(player.id)) {
      throw new Error(`Player already exists: ${player.id}`);
    }
    this.players.set(player.id, player);
    return player;
  }

  async getPlayer(id) {
    return this.players.get(id) || null;
  }

  async getPlayerBySocket(socketId) {
    const playerId = this.sockets.get(socketId);
    if (!playerId) return null;
    return this.players.get(playerId) || null;
  }

  async updatePlayer(id, updates) {
    const player = this.players.get(id);
    if (!player) return null;
    Object.assign(player, updates);
    return player;
  }

  async deletePlayer(id) {
    const player = this.players.get(id);
    if (player && player.socketId) {
      this.sockets.delete(player.socketId);
    }
    this.playerSockets.delete(id);
    this.players.delete(id);
  }

  async listPlayers() {
    return Array.from(this.players.values());
  }

  // ─── Sockets ───────────────────────────────────────────────────
  async linkSocket(socketId, playerId) {
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

  async unlinkSocket(socketId) {
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

  async getPlayerIdBySocket(socketId) {
    return this.sockets.get(socketId) || null;
  }

  async getSocketByPlayerId(playerId) {
    return this.playerSockets.get(playerId) || null;
  }

  // ─── Rooms ─────────────────────────────────────────────────────
  async createRoom(room) {
    if (!room || !room.id) {
      throw new Error('Room must have an id');
    }
    if (this.rooms.has(room.id)) {
      throw new Error(`Room already exists: ${room.id}`);
    }
    this.rooms.set(room.id, room);
    return room;
  }

  async getRoom(id) {
    return this.rooms.get(id) || null;
  }

  async updateRoom(id, updates) {
    const room = this.rooms.get(id);
    if (!room) return null;
    Object.assign(room, updates);
    return room;
  }

  async deleteRoom(id) {
    this.rooms.delete(id);
    this.games.delete(id);
  }

  async listRooms(filter = {}) {
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
  async createGame(game) {
    if (!game || !game.roomId) {
      throw new Error('Game must have a roomId');
    }
    this.games.set(game.roomId, game);
    return game;
  }

  async getGame(roomId) {
    return this.games.get(roomId) || null;
  }

  async updateGame(roomId, updates) {
    const game = this.games.get(roomId);
    if (!game) return null;
    Object.assign(game, updates);
    return game;
  }

  async deleteGame(roomId) {
    this.games.delete(roomId);
  }

  // ─── Cleanup ───────────────────────────────────────────────────
  async cleanup() {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (room.players.length === 0 && (now - room.createdAt) > 3600000) {
        await this.deleteRoom(id);
      }
    }
  }
}

module.exports = new MemoryStore();
