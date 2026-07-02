/**
 * backend/services/room-manager.js - Room/Lobby Management
 *
 * Handles room creation, joining, leaving, and ready state management.
 */

const store = require('../storage/memory-store');
const {
  MAX_SEATS,
  MIN_PLAYERS,
  DEFAULT_MAX_PLAYERS,
  DEFAULT_SMALL_BLIND,
  DEFAULT_BIG_BLIND,
  DEFAULT_INITIAL_CHIPS,
  ROOM_ID_LENGTH,
} = require('../config/constants');

class RoomManager {
  /**
   * Create a new room and automatically add the host as a player.
   */
  async createRoom(hostId, config = {}) {
    const id = await this._generateRoomId();

    const maxPlayers = config.maxPlayers ?? DEFAULT_MAX_PLAYERS;
    const smallBlind = config.smallBlind ?? DEFAULT_SMALL_BLIND;
    const bigBlind = config.bigBlind ?? DEFAULT_BIG_BLIND;

    if (maxPlayers < MIN_PLAYERS || maxPlayers > MAX_SEATS) {
      throw new Error(`maxPlayers must be between ${MIN_PLAYERS} and ${MAX_SEATS}`);
    }
    if (smallBlind <= 0 || bigBlind <= 0) {
      throw new Error('Blinds must be positive');
    }
    if (bigBlind !== smallBlind * 2) {
      throw new Error('bigBlind must be 2 × smallBlind');
    }

    const room = {
      id,
      name: config.name ?? `Room ${id}`,
      hostId,
      maxPlayers,
      smallBlind,
      bigBlind,
      initialChips: config.initialChips ?? DEFAULT_INITIAL_CHIPS,
      allowAI: config.allowAI ?? true,
      isPrivate: config.isPrivate ?? false,
      password: config.password || null,
      status: 'waiting', // waiting, playing, ended
      players: [],       // Array of { playerId, seatPosition, isReady, chips, buyInTotal, borrowCount }
      seats: Array(MAX_SEATS).fill(null),
      chatHistory: [],
      currentGameId: null,
      dealerPosition: null,
      awaitingNextHandReady: false,
      createdAt: Date.now(),
      gameStartedAt: null,
    };

    await store.createRoom(room);

    // Host automatically joins their own room
    await this.joinRoom(id, hostId);

    return this._sanitizeRoom(room);
  }

  /**
   * Get room by ID
   */
  async getRoom(roomId) {
    return store.getRoom(roomId);
  }

  /**
   * Get sanitized public rooms (waiting and public only)
   */
  async listPublicRooms() {
    const rooms = await store.listRooms({ status: 'waiting', isPublic: true });
    return rooms.map(r => this._sanitizeRoom(r));
  }

  /**
   * Player joins a room (lobby, not seated)
   */
  async joinRoom(roomId, playerId, password = null) {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.status === 'playing') return { success: false, error: 'Game in progress' };

    const player = await store.getPlayer(playerId);
    if (!player) return { success: false, error: 'Player not found' };

    // If already in room - idempotent
    if (room.players.some(p => p.playerId === playerId)) {
      return { success: true, room: this._sanitizeRoom(room) };
    }

    const seatedCount = room.players.filter(p => p.seatPosition >= 0).length;
    if (seatedCount >= room.maxPlayers) {
      return { success: false, error: 'Room is full' };
    }
    if (room.isPrivate && room.password && room.password !== password) {
      return { success: false, error: 'Invalid password' };
    }

    // Force leave old room if in another
    if (player.currentRoom && player.currentRoom !== roomId) {
      await this.leaveRoom(player.currentRoom, playerId);
    }

    room.players.push({
      playerId,
      nickname: player.nickname,
      avatar: player.avatar,
      seatPosition: -1,
      isReady: false,
      chips: room.initialChips,
      buyInTotal: room.initialChips,
      borrowCount: 0,
      isAI: Boolean(player.isAI),
    });

    const currentHost = room.players.find(p => p.playerId === room.hostId);
    if (!player.isAI && (!currentHost || this._isAIPlayer(currentHost))) {
      room.hostId = playerId;
    }

    player.currentRoom = roomId;
    player.seatPosition = -1;
    player.isReady = false;
    player.chips = room.initialChips;

    return { success: true, room: this._sanitizeRoom(room) };
  }

  /**
   * Player leaves a room
   */
  async leaveRoom(roomId, playerId) {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const playerIndex = room.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) return { success: false, error: 'Not in room' };

    const player = room.players[playerIndex];
    const isHostLeaving = room.hostId === playerId;

    if (isHostLeaving) {
      const settlements = room.players.map(p => this._settleRoomPlayer(room, p));
      await Promise.all(room.players.map(p => this._clearStoredPlayerRoomState(p.playerId)));
      await store.deleteRoom(roomId);
      return {
        success: true,
        roomDeleted: true,
        hostLeft: true,
        settlements,
      };
    }

    // Free up seat if seated
    if (player.seatPosition >= 0 && room.seats[player.seatPosition] === playerId) {
      room.seats[player.seatPosition] = null;
    }

    const settlement = this._settleRoomPlayer(room, player);

    room.players.splice(playerIndex, 1);

    await this._clearStoredPlayerRoomState(playerId);

    // Clean up empty rooms
    if (room.players.length === 0) {
      await store.deleteRoom(roomId);
      return { success: true, roomDeleted: true, settlement };
    }

    return { success: true, room: this._sanitizeRoom(room), settlement };
  }

  /**
   * Borrow one initial stack after going broke.
   */
  async borrowChips(roomId, playerId) {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.status === 'playing') return { success: false, error: 'Cannot borrow during a hand' };

    const player = room.players.find(p => p.playerId === playerId);
    if (!player) return { success: false, error: 'Not in room' };
    if (player.seatPosition < 0) return { success: false, error: 'Must be seated to borrow chips' };
    if ((player.chips ?? 0) > 0) return { success: false, error: 'You still have chips' };

    this._normalizeRoomPlayerLedger(room, player);
    const stackSize = room.initialChips ?? DEFAULT_INITIAL_CHIPS;
    player.chips += stackSize;
    player.buyInTotal += stackSize;
    player.borrowCount += 1;
    player.isReady = false;

    const storedPlayer = await store.getPlayer(playerId);
    if (storedPlayer) {
      storedPlayer.chips = player.chips;
      storedPlayer.isReady = false;
    }

    return {
      success: true,
      settlement: this._buildSettlement(room, player),
      room: this._sanitizeRoom(room),
    };
  }

  /**
   * Automatically lend one initial stack to every broke AI that is seated.
   * Returns the list of players that received chips.
   */
  async autoLendToBrokeAI(roomId) {
    const room = await store.getRoom(roomId);
    if (!room || room.status === 'playing') return { lent: [] };

    const stackSize = room.initialChips ?? DEFAULT_INITIAL_CHIPS;
    const lent = [];

    for (const player of room.players) {
      if (this._isAIPlayer(player) && player.seatPosition >= 0 && (player.chips ?? 0) <= 0) {
        this._normalizeRoomPlayerLedger(room, player);
        player.chips += stackSize;
        player.buyInTotal += stackSize;
        player.borrowCount += 1;
        player.isReady = true;

        const storedPlayer = await store.getPlayer(player.playerId);
        if (storedPlayer) {
          storedPlayer.chips = player.chips;
          storedPlayer.isReady = true;
        }

        lent.push({
          playerId: player.playerId,
          position: player.seatPosition,
          amount: stackSize,
        });
      }
    }

    return { lent };
  }

  /**
   * Player sits at a seat
   */
  async sit(roomId, playerId, position) {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.status === 'playing') return { success: false, error: 'Game in progress' };
    if (position < 0 || position >= MAX_SEATS) return { success: false, error: 'Invalid seat' };

    // Idempotent: already sitting at this seat
    if (room.seats[position] === playerId) {
      return { success: true, seatPosition: position };
    }

    if (room.seats[position]) return { success: false, error: 'Seat taken' };

    const player = room.players.find(p => p.playerId === playerId);
    if (!player) return { success: false, error: 'Not in room' };

    const seatedCount = room.players.filter(p => p.seatPosition >= 0).length;
    if (seatedCount >= room.maxPlayers && player.seatPosition < 0) {
      return { success: false, error: 'Max players reached' };
    }

    // Leave old seat
    if (player.seatPosition >= 0) {
      room.seats[player.seatPosition] = null;
    }

    // Take new seat
    room.seats[position] = playerId;
    player.seatPosition = position;
    player.isReady = false;

    const p = await store.getPlayer(playerId);
    if (p) {
      p.seatPosition = position;
      p.isReady = false;
    }

    return { success: true, seatPosition: position };
  }

  /**
   * Player stands up
   */
  async stand(roomId, playerId) {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const player = room.players.find(p => p.playerId === playerId);
    if (!player) return { success: false, error: 'Not in room' };
    if (player.seatPosition < 0) return { success: false, error: 'Not seated' };

    room.seats[player.seatPosition] = null;
    player.seatPosition = -1;
    player.isReady = false;

    const p = await store.getPlayer(playerId);
    if (p) {
      p.seatPosition = -1;
      p.isReady = false;
    }

    return { success: true };
  }

  /**
   * Toggle ready state
   */
  async ready(roomId, playerId, isReady) {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const player = room.players.find(p => p.playerId === playerId);
    if (!player) return { success: false, error: 'Not in room' };
    if (player.seatPosition < 0) return { success: false, error: 'Must be seated to ready' };
    if (isReady && (player.chips ?? 0) <= 0) {
      return { success: false, error: 'Must borrow chips before ready' };
    }

    player.isReady = isReady;

    const p = await store.getPlayer(playerId);
    if (p) p.isReady = isReady;

    return { success: true, isReady };
  }

  /**
   * Check if game can start
   */
  async canStart(roomId) {
    const room = await store.getRoom(roomId);
    if (!room) return false;
    if (room.status !== 'waiting') return false;

    const seated = room.players.filter(p => p.seatPosition >= 0);
    if (seated.length < MIN_PLAYERS) return false;

    return seated.every(p => p.isReady && (p.chips ?? 0) > 0);
  }

  /**
   * Start a game from a room
   */
  async startGame(roomId, hostId) {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };
    if (!this._canControlRoom(room, hostId)) {
      return { success: false, error: 'Only host can start' };
    }
    if (room.hostId !== hostId) {
      room.hostId = hostId;
    }
    if (!(await this.canStart(roomId))) {
      return { success: false, error: 'Not all seated players are ready' };
    }

    room.status = 'playing';
    room.gameStartedAt = Date.now();
    room.awaitingNextHandReady = false;
    return { success: true, roomId };
  }

  /**
   * Get seated players
   */
  async getSeatedPlayers(roomId) {
    const room = await store.getRoom(roomId);
    if (!room) return [];
    return room.players.filter(p => p.seatPosition >= 0);
  }

  /**
   * Set room status
   */
  async setStatus(roomId, status) {
    const room = await store.getRoom(roomId);
    if (!room) return false;
    room.status = status;
    if (status === 'playing') {
      room.gameStartedAt = Date.now();
    }
    return true;
  }

  /**
   * Fill empty seats with AI bots up to maxPlayers
   */
  async fillRoomWithAI(roomId, aiManager) {
    const room = await store.getRoom(roomId);
    if (!room || !room.allowAI) return [];

    const bots = [];
    const seatedCount = room.players.filter(p => p.seatPosition >= 0).length;
    const needed = room.maxPlayers - seatedCount;

    for (let i = 0; i < needed; i++) {
      const position = room.seats.findIndex((pid, idx) => !pid && idx < MAX_SEATS);
      if (position === -1) break;
      const bot = await aiManager.createBot(roomId, position);
      if (bot) bots.push(bot);
    }

    return bots;
  }

  /**
   * Add a single AI bot to the first open seat.
   */
  async addAI(roomId, aiManager) {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };
    if (!room.allowAI) return { success: false, error: 'AI is disabled for this room' };
    if (room.status !== 'waiting') return { success: false, error: 'Game in progress' };

    const seatedCount = room.players.filter(p => p.seatPosition >= 0).length;
    if (seatedCount >= room.maxPlayers) {
      return { success: false, error: 'Room is full' };
    }

    const position = room.seats.findIndex((pid, idx) => !pid && idx < room.maxPlayers);
    if (position === -1) {
      return { success: false, error: 'No open seat' };
    }

    const bot = await aiManager.createBot(roomId, position);
    if (!bot) return { success: false, error: 'Failed to add AI' };

    return { success: true, bot };
  }

  /**
   * Remove an AI bot from a specific seat in a waiting room.
   */
  async removeAI(roomId, position, aiManager) {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.status !== 'waiting') return { success: false, error: 'Game in progress' };
    if (!Number.isInteger(position) || position < 0 || position >= room.maxPlayers) {
      return { success: false, error: 'Invalid seat' };
    }

    const playerId = room.seats[position];
    if (!playerId) return { success: false, error: 'Seat is empty' };

    const player = room.players.find(p => p.playerId === playerId);
    if (!this._isAIPlayer(player)) {
      return { success: false, error: 'Seat is not an AI player' };
    }

    const removed = await aiManager.removeBot(roomId, position);
    if (!removed) return { success: false, error: 'Failed to remove AI' };

    return { success: true, position };
  }

  // ─── Private helpers ───────────────────────────────────────────

  async _generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let attempts = 0;
    while (attempts < 100) {
      let id = '';
      for (let i = 0; i < ROOM_ID_LENGTH; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
      }
      if (!(await store.getRoom(id))) {
        return id;
      }
      attempts++;
    }
    throw new Error('Failed to generate unique room ID');
  }

  _sanitizeRoom(room) {
    return {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      smallBlind: room.smallBlind,
      bigBlind: room.bigBlind,
      initialChips: room.initialChips,
      allowAI: room.allowAI,
      isPrivate: room.isPrivate,
      status: room.status,
      playerCount: room.players.length,
      seatedCount: room.players.filter(p => p.seatPosition >= 0).length,
      createdAt: room.createdAt,
      dealerPosition: room.dealerPosition,
      awaitingNextHandReady: Boolean(room.awaitingNextHandReady),
      seats: this._buildSeatArray(room),
      players: room.players.map(p => ({
        playerId: p.playerId,
        nickname: p.nickname,
        avatar: p.avatar,
        seatPosition: p.seatPosition,
        isReady: p.isReady,
        chips: p.chips,
        buyInTotal: p.buyInTotal ?? room.initialChips,
        borrowCount: p.borrowCount ?? 0,
        netResult: (p.chips ?? 0) - (p.buyInTotal ?? room.initialChips),
        isAI: this._isAIPlayer(p),
      })),
    };
  }

  _buildSeatArray(room) {
    const seats = [];
    for (let pos = 0; pos < MAX_SEATS; pos++) {
      const playerId = room.seats[pos];
      if (playerId) {
        const player = room.players.find(p => p.playerId === playerId);
        if (player) {
          seats.push({
            position: pos,
            playerId: player.playerId,
            nickname: player.nickname,
            avatar: player.avatar,
            isReady: player.isReady,
            chips: player.chips,
            buyInTotal: player.buyInTotal ?? room.initialChips,
            borrowCount: player.borrowCount ?? 0,
            netResult: (player.chips ?? 0) - (player.buyInTotal ?? room.initialChips),
            status: 'occupied',
            isAI: this._isAIPlayer(player),
          });
        }
      } else {
        seats.push({ position: pos, status: 'empty' });
      }
    }
    return seats;
  }

  _selectNextHost(players) {
    return players.find(p => p.seatPosition >= 0 && !this._isAIPlayer(p))
      || players.find(p => !this._isAIPlayer(p))
      || players.find(p => p.seatPosition >= 0)
      || players[0]
      || null;
  }

  _canControlRoom(room, playerId) {
    if (room.hostId === playerId) return true;

    const requester = room.players.find(p => p.playerId === playerId);
    if (!requester || requester.seatPosition < 0 || this._isAIPlayer(requester)) {
      return false;
    }

    const currentHost = room.players.find(p => p.playerId === room.hostId);
    return !currentHost || this._isAIPlayer(currentHost);
  }

  _isAIPlayer(player) {
    return Boolean(player && (
      player.isAI ||
      (typeof player.nickname === 'string' && player.nickname.startsWith('Bot-'))
    ));
  }

  _normalizeRoomPlayerLedger(room, player) {
    const initialChips = room.initialChips ?? DEFAULT_INITIAL_CHIPS;
    if (!Number.isFinite(player.chips)) player.chips = initialChips;
    if (!Number.isFinite(player.buyInTotal)) player.buyInTotal = initialChips;
    if (!Number.isInteger(player.borrowCount)) {
      player.borrowCount = Math.max(0, Math.round((player.buyInTotal - initialChips) / initialChips));
    }
  }

  _buildSettlement(room, player) {
    this._normalizeRoomPlayerLedger(room, player);
    const chips = player.chips ?? 0;
    const buyInTotal = player.buyInTotal ?? (room.initialChips ?? DEFAULT_INITIAL_CHIPS);
    return {
      playerId: player.playerId,
      nickname: player.nickname,
      seatPosition: player.seatPosition,
      chips,
      buyInTotal,
      borrowCount: player.borrowCount ?? 0,
      netResult: chips - buyInTotal,
    };
  }

  _settleRoomPlayer(room, player) {
    return this._buildSettlement(room, player);
  }

  async _clearStoredPlayerRoomState(playerId) {
    const player = await store.getPlayer(playerId);
    if (!player) return;
    player.currentRoom = null;
    player.seatPosition = -1;
    player.isReady = false;
    player.chips = 0;
  }
}

module.exports = new RoomManager();
