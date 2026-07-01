/**
 * backend/services/player-manager.js - Player Session Management
 *
 * Handles guest player creation, session tracking, and chip management.
 */

const { randomUUID } = require('crypto');
const store = require('../storage/memory-store');
const { GUEST_NAMES, GUEST_AVATARS, DEFAULT_INITIAL_CHIPS } = require('../config/constants');

class PlayerManager {
  /**
   * Create a new guest player. Idempotent for the same socketId.
   */
  async createGuest(socketId) {
    if (socketId) {
      const existing = await store.getPlayerBySocket(socketId);
      if (existing) {
        existing.lastActive = Date.now();
        existing.isOnline = true;
        return existing;
      }
    }

    const id = this._generateId();
    const nickname = this._generateNickname();
    const avatar = this._generateAvatar();

    const player = {
      id,
      username: null,
      nickname,
      avatar,
      chips: DEFAULT_INITIAL_CHIPS,
      isGuest: true,
      socketId: socketId || null,
      isOnline: true,
      currentRoom: null,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
      lastActive: Date.now(),
    };

    await store.createPlayer(player);
    if (socketId) {
      await store.linkSocket(socketId, id);
    }

    return player;
  }

  /**
   * Get or create a guest for a socket.
   */
  async getOrCreateGuest(socketId) {
    return this.createGuest(socketId);
  }

  /**
   * Get player by ID
   */
  async getPlayerById(id) {
    return store.getPlayer(id);
  }

  /**
   * Get player by socket ID
   */
  async getPlayerBySocket(socketId) {
    return store.getPlayerBySocket(socketId);
  }

  /**
   * Update player's socket (e.g., after reconnect)
   */
  async setPlayerSocket(playerId, newSocketId) {
    const player = await store.getPlayer(playerId);
    if (!player) return null;

    if (player.socketId) {
      await store.unlinkSocket(player.socketId);
    }

    player.socketId = newSocketId;
    player.isOnline = true;
    player.lastActive = Date.now();

    if (newSocketId) {
      await store.linkSocket(newSocketId, playerId);
    }
    return player;
  }

  /**
   * Mark player as offline
   */
  async disconnectPlayer(playerId) {
    const player = await store.getPlayer(playerId);
    if (!player) return null;

    player.isOnline = false;
    player.lastActive = Date.now();
    if (player.socketId) {
      await store.unlinkSocket(player.socketId);
      player.socketId = null;
    }
    return player;
  }

  /**
   * Mark player as online
   */
  async setOnline(playerId) {
    const player = await store.getPlayer(playerId);
    if (!player) return null;

    player.isOnline = true;
    player.lastActive = Date.now();
    return player;
  }

  /**
   * Update player fields
   */
  async updatePlayer(playerId, updates) {
    return store.updatePlayer(playerId, updates);
  }

  /**
   * Update player activity timestamp
   */
  async touch(playerId) {
    const player = await store.getPlayer(playerId);
    if (player) {
      player.lastActive = Date.now();
    }
  }

  /**
   * Remove player completely
   */
  async removePlayer(playerId) {
    const player = await store.getPlayer(playerId);
    if (player && player.socketId) {
      await store.unlinkSocket(player.socketId);
    }
    await store.deletePlayer(playerId);
  }

  // ─── Placeholders for MVP+ auth ────────────────────────────────
  async register(username, password) {
    throw new Error('Registration not implemented in MVP');
  }

  async login(username, password) {
    throw new Error('Login not implemented in MVP');
  }

  // ─── Private helpers ───────────────────────────────────────────

  _generateId() {
    return randomUUID();
  }

  _generateNickname() {
    const name = GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)];
    const num = Math.floor(Math.random() * 9999);
    return `${name}_${num}`;
  }

  _generateAvatar() {
    return GUEST_AVATARS[Math.floor(Math.random() * GUEST_AVATARS.length)];
  }
}

module.exports = new PlayerManager();
