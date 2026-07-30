/**
 * backend/services/player-manager.ts - Player Session Management
 *
 * Handles guest player creation, session tracking, and chip management.
 */

import { randomUUID } from 'crypto';
import type { PlayerRecord, RoomRecord, Storage } from '../storage/memory-store';
import { GUEST_NAMES, GUEST_AVATARS, DEFAULT_INITIAL_CHIPS } from '../config/constants';

// The store satisfies the Storage contract; the concrete memory store also
// exposes its maps, which updateNickname() walks for the fan-out update.
const store: Storage & { rooms: Map<string, RoomRecord> } = require('../storage/memory-store');
const authService = require('./auth-service');

/** Result of register()/login(): failure reason or the authed player. */
type AuthResult =
  | { success: false; error: string; code?: string }
  | { success: true; player: PlayerRecord };

/** Result of updateNickname(): either a failure reason or the synced payload. */
type UpdateNicknameResult =
  | { success: false; error: string }
  | { success: true; roomId: string | null; player: PlayerRecord };

class PlayerManager {
  /**
   * Create a new guest player. Idempotent for the same socketId.
   */
  async createGuest(socketId: string | null): Promise<PlayerRecord> {
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

    const player: PlayerRecord = {
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
  async getOrCreateGuest(socketId: string | null): Promise<PlayerRecord> {
    return this.createGuest(socketId);
  }

  /**
   * Get player by ID
   */
  async getPlayerById(id: string): Promise<PlayerRecord | null> {
    return store.getPlayer(id);
  }

  /**
   * Get player by socket ID
   */
  async getPlayerBySocket(socketId: string): Promise<PlayerRecord | null> {
    return store.getPlayerBySocket(socketId);
  }

  /**
   * Update player's socket (e.g., after reconnect)
   */
  async setPlayerSocket(playerId: string, newSocketId: string | null): Promise<PlayerRecord | null> {
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
  async disconnectPlayer(playerId: string): Promise<PlayerRecord | null> {
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
  async setOnline(playerId: string): Promise<PlayerRecord | null> {
    const player = await store.getPlayer(playerId);
    if (!player) return null;

    player.isOnline = true;
    player.lastActive = Date.now();
    return player;
  }

  /**
   * Update player fields
   */
  async updatePlayer(playerId: string, updates: Partial<PlayerRecord>): Promise<PlayerRecord | null> {
    return store.updatePlayer(playerId, updates);
  }

  /**
   * Update a player's display nickname everywhere it is denormalized.
   */
  async updateNickname(playerId: string, nickname: any): Promise<UpdateNicknameResult> {
    const cleanNickname = typeof nickname === 'string' ? nickname.trim().slice(0, 20) : '';
    if (!cleanNickname) {
      return { success: false, error: 'Nickname is required' };
    }

    const player = await store.getPlayer(playerId);
    if (!player) return { success: false, error: 'Player not found' };

    player.nickname = cleanNickname;
    player.lastActive = Date.now();
    // Write the record back through the storage contract. Copy-returning
    // backends (postgres/redis) hand out detached objects, so mutating the
    // fetched record alone is silently dropped and a later joinRoom() reads
    // the stale nickname. Memory shares the live ref, so this is a no-op
    // there. Mirrors room-manager's _persistPlayer/_persistRoom pattern.
    await store.updatePlayer(playerId, {
      nickname: cleanNickname,
      lastActive: player.lastActive,
    });

    let roomId: string | null = player.currentRoom || null;
    if (roomId) {
      const room = await store.getRoom(roomId);
      const roomPlayer = room?.players?.find((p: any) => p.playerId === playerId);
      if (room && roomPlayer) {
        roomPlayer.nickname = cleanNickname;
        await store.updateRoom(room.id, room);
      }
    }

    if (!roomId) {
      for (const room of store.rooms.values()) {
        const roomPlayer = room.players?.find((p: any) => p.playerId === playerId);
        if (roomPlayer) {
          roomPlayer.nickname = cleanNickname;
          roomId = room.id;
          await store.updateRoom(room.id, room);
          break;
        }
      }
    }

    if (roomId) {
      const game = await store.getGame(roomId);
      const gamePlayer = game?.players?.find((p: any) => p.playerId === playerId);
      if (game && gamePlayer) {
        gamePlayer.nickname = cleanNickname;
        await store.updateGame(roomId, game);
      }
    }

    return {
      success: true,
      roomId,
      player: {
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        chips: player.chips,
      },
    };
  }

  /**
   * Update player activity timestamp
   */
  async touch(playerId: string): Promise<void> {
    const player = await store.getPlayer(playerId);
    if (player) {
      player.lastActive = Date.now();
    }
  }

  /**
   * Remove player completely
   */
  async removePlayer(playerId: string): Promise<void> {
    const player = await store.getPlayer(playerId);
    if (player && player.socketId) {
      await store.unlinkSocket(player.socketId);
    }
    await store.deletePlayer(playerId);
  }

  // ─── Registered-user auth (JWT issued by the route layer) ────────

  /**
   * Find a registered player by username (case-insensitive).
   */
  async findByUsername(username: string): Promise<PlayerRecord | null> {
    const needle = username.toLowerCase();
    const players = await store.listPlayers();
    return players.find(p => typeof p.username === 'string' && p.username.toLowerCase() === needle) || null;
  }

  /**
   * Create a registered user. Input shape is validated by the route;
   * uniqueness is enforced here against the store.
   */
  async register(username: string, password: string): Promise<AuthResult> {
    const existing = await this.findByUsername(username);
    if (existing) {
      return { success: false, error: 'Username already taken', code: 'USERNAME_TAKEN' };
    }

    const passwordHash = await authService.hashPassword(password);
    const player: PlayerRecord = {
      id: this._generateId(),
      username,
      passwordHash,
      nickname: username,
      avatar: this._generateAvatar(),
      chips: DEFAULT_INITIAL_CHIPS,
      isGuest: false,
      socketId: null,
      isOnline: false,
      currentRoom: null,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
      lastActive: Date.now(),
    };

    await store.createPlayer(player);
    return { success: true, player };
  }

  /**
   * Verify credentials. A real bcrypt compare runs even when the username
   * is unknown (dummy hash) so the response time does not reveal which
   * usernames exist.
   */
  async login(username: string, password: string): Promise<AuthResult> {
    const player = await this.findByUsername(username);
    const hash = player?.passwordHash || await authService.dummyPasswordHash();
    const passwordOk = await authService.verifyPassword(password, hash);

    if (!player || !passwordOk) {
      return { success: false, error: 'Invalid username or password', code: 'BAD_CREDENTIALS' };
    }

    player.lastLoginAt = Date.now();
    player.lastActive = Date.now();
    return { success: true, player };
  }

  // ─── Private helpers ───────────────────────────────────────────

  _generateId(): string {
    return randomUUID();
  }

  _generateNickname(): string {
    const name = GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)];
    const num = Math.floor(Math.random() * 9999);
    return `${name}_${num}`;
  }

  _generateAvatar(): string {
    return GUEST_AVATARS[Math.floor(Math.random() * GUEST_AVATARS.length)];
  }
}

/** Instance type for typed cross-service imports (erased at runtime). */
export type PlayerManagerService = PlayerManager;

// Export the singleton instance exactly like the former .js module did;
// plain `module.exports =` stays runtime-safe under tsx/esbuild (see
// backend/storage/memory-store.ts for the detailed rationale).
module.exports = new PlayerManager();
