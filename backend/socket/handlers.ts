/**
 * backend/socket/handlers.ts - Socket.IO Event Handlers
 *
 * Handles all real-time game events.
 */

// Pull @types/node (globals + node:* module declarations) into the program.
// The legacy .js files used to drag these in transitively through their
// require('node:*') calls; with the backend fully on .ts (imports only),
// nothing else references them and tsc loses the Node globals.
/// <reference types="node" />

import type { PlayerManagerService } from '../services/player-manager';
import type { RoomManagerService } from '../services/room-manager';
import type { GameEngineService } from '../services/game-engine';
import type { AIManagerService } from '../services/ai-manager';
import type { Storage } from '../storage/memory-store';

const playerManager: PlayerManagerService = require('../services/player-manager');
const roomManager: RoomManagerService = require('../services/room-manager');
const gameEngine: GameEngineService = require('../services/game-engine');
const aiManager: AIManagerService = require('../services/ai-manager');
const store: Storage = require('../storage/memory-store');
const authService = require('../services/auth-service');
const { ACTION_TIMEOUT_MS, DISCONNECT_TIMEOUT_MS } = require('../config/constants');
const EVENTS = require('./events');

// Map playerId -> disconnect timeout
const disconnectTimers = new Map();

// Turn scheduling state lives in this scheduler layer, never on the stored
// game entity (INV2/INV3).
const turnTimers = new Map();    // roomId -> { timer, seatPosition, playerId, timeoutAt }
const aiSchedules = new Map();   // roomId -> turnKey of the scheduled AI decision

// Multi-instance scheduler ownership (P5a). Null in single-instance mode
// (no REDIS_URL): every scheduling decision then stays local and the code
// paths below behave exactly as before. When set (a SchedulerOwner), turn
// timers and AI schedules are created only on the instance holding the
// room lock; other instances signal the owner over the scheduler bus.
// disconnectTimers stay connection-local on every instance by design.
let scheduler: any = null;

function setupSocketHandlers(io: any, options: { scheduler?: any } = {}): void {
  scheduler = options.scheduler || null;
  if (scheduler) {
    scheduler.onTurnSignal((roomId: string, turn: any) => {
      _onTurnSignal(io, roomId, turn).catch(err => {
        console.error('[Scheduler] Turn signal error:', err);
      });
    });
  }
  io.on('connection', (socket: any) => {
    console.log('[Socket] Client connected:', socket.id);

    handleConnection(socket, io).catch(err => {
      console.error('[Socket] Connection handler error:', err);
      socket.emit(EVENTS.SERVER.ERROR, { error: 'Internal error' });
    });
  });
}

async function handleConnection(socket: any, io: any): Promise<void> {
  // Try to restore player from token (authoritative) or query (legacy)
  let player: any = null;
  const queryPlayerId = socket.handshake.query.playerId;
  const authToken = socket.handshake.auth?.token;

  // A presented token must verify: an invalid/expired token rejects the
  // connection outright instead of silently downgrading identity.
  let tokenPlayerId: string | null = null;
  if (typeof authToken === 'string' && authToken) {
    const payload = authService.verifyToken(authToken);
    if (!payload) {
      socket.emit(EVENTS.SERVER.ERROR, {
        code: 'AUTH_INVALID',
        error: 'Invalid or expired token',
      });
      if (typeof socket.disconnect === 'function') socket.disconnect(true);
      return;
    }
    tokenPlayerId = payload.playerId;
  }

  const bindPlayerId = tokenPlayerId || queryPlayerId;

  if (bindPlayerId) {
    player = await playerManager.getPlayerById(bindPlayerId);
    if (player) {
      await playerManager.setPlayerSocket(player.id, socket.id);
      // Cancel pending disconnect timer if any
      if (disconnectTimers.has(player.id)) {
        clearTimeout(disconnectTimers.get(player.id));
        disconnectTimers.delete(player.id);
      }
      console.log('[Socket] Restored player:', player.nickname);

      // Re-join socket room if player was in a room
      if (player.currentRoom) {
        socket.join(player.currentRoom);
        _broadcastRoomState(io, player.currentRoom);
        const gameState = await gameEngine.getGameState(player.currentRoom, player.id);
        if (gameState) {
          socket.emit(EVENTS.SERVER.GAME_STATE, { gameState });
        }
        // Same mid-turn recovery as request_state: re-send the private turn
        // snapshot if this player is the one to act.
        await _resendTurnToPlayer(socket, player.currentRoom, player.id);
      }
    }
  }

  let createdGuest = false;
  if (!player) {
    player = await playerManager.getPlayerBySocket(socket.id);
    if (!player) {
      player = await playerManager.createGuest(socket.id);
      createdGuest = true;
    } else {
      await playerManager.setPlayerSocket(player.id, socket.id);
    }
  }

  // A silently created guest gets a token so token-aware clients can
  // authenticate future connections instead of relying on the query id.
  const connectedToken = createdGuest ? authService.signToken(player.id, 'guest') : undefined;
  socket.emit(EVENTS.SERVER.CONNECTED || 'connected', _buildConnectedPayload(player, connectedToken));

  // If the client supplied an unknown playerId, tell them to re-create
  if (queryPlayerId && !player) {
    socket.emit(EVENTS.SERVER.ERROR, {
      code: 'PLAYER_UNKNOWN',
      error: 'Player session expired, please re-create',
    });
  }

  // ─── Room Events ─────────────────────────────────────────────

  // Resolve the player's current room from the store on every event. The
  // closure-captured `player` is a detached copy under copy-returning
  // stores (Redis): joinRoom() only updates the stored record, so reading
  // `player.currentRoom` here would go stale after any room change —
  // including joins made over REST — and silently drop every action.
  const currentRoomId = async (): Promise<string | null> => {
    const fresh = await playerManager.getPlayerById(player.id);
    return fresh?.currentRoom ?? null;
  };

  socket.on(EVENTS.CLIENT.JOIN_ROOM, async (data: any = {}) => {
    try {
      const { roomId, password } = data;
      if (!roomId || typeof roomId !== 'string') {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'Room ID required' });
      }

      // Capture the current room before joinRoom force-leaves it.
      const prevRoomId = await currentRoomId();
      const result = await roomManager.joinRoom(roomId, player.id, password);
      if (!result.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: result.error });
      }

      socket.join(roomId);
      // A room switch only force-leaves the old room in the data layer; drop
      // the socket.io membership too so old-room broadcasts stop arriving.
      if (prevRoomId && prevRoomId !== roomId) {
        socket.leave(prevRoomId);
      }

      const room = await roomManager.getRoom(roomId);
      const seat = room!.players.find(p => p.playerId === player.id);

      io.to(roomId).emit(EVENTS.SERVER.PLAYER_JOINED, {
        seat: {
          position: seat!.seatPosition,
          playerId: player.id,
          nickname: player.nickname,
          avatar: player.avatar,
          isReady: seat!.isReady,
        },
      });

      _broadcastRoomState(io, roomId);
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.LEAVE_ROOM, async () => {
    try {
      const roomId = await currentRoomId();
      if (!roomId) return;

      const roomBefore = await roomManager.getRoom(roomId);
      const seatPosition = roomBefore?.players.find(p => p.playerId === player.id)?.seatPosition ?? -1;

      const result = await roomManager.leaveRoom(roomId, player.id);

      if (result.hostLeft) {
        io.to(roomId).emit(EVENTS.SERVER.ROOM_SETTLED, {
          roomId,
          settlements: result.settlements,
          roomDeleted: true,
          reason: 'host_left',
        });
        socket.leave(roomId);
        return;
      }

      if (result.settlement) {
        socket.emit(EVENTS.SERVER.ROOM_SETTLEMENT, {
          roomId,
          settlement: result.settlement,
          roomDeleted: Boolean(result.roomDeleted),
        });
      }

      socket.leave(roomId);

      io.to(roomId).emit(EVENTS.SERVER.PLAYER_LEFT, { position: seatPosition });
      _broadcastRoomState(io, roomId);
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.SIT, async (data: any = {}) => {
    try {
      const roomId = await currentRoomId();
      if (!roomId) return;
      if (data.position == null || typeof data.position !== 'number') {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'Seat position required' });
      }

      const result = await roomManager.sit(roomId, player.id, data.position);
      if (!result.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: result.error });
      }

      _broadcastRoomState(io, roomId);
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.STAND, async () => {
    try {
      const roomId = await currentRoomId();
      if (!roomId) return;

      const result = await roomManager.stand(roomId, player.id);
      if (!result.success) return;

      _broadcastRoomState(io, roomId);
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.READY, async (data: any = {}) => {
    try {
      const roomId = await currentRoomId();
      if (!roomId) return;
      if (typeof data.ready !== 'boolean') {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'ready must be boolean' });
      }

      const result = await roomManager.ready(roomId, player.id, data.ready);
      if (!result.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: result.error });
      }

      const room = await roomManager.getRoom(roomId);
      const seat = room!.players.find(p => p.playerId === player.id);

      io.to(roomId).emit(EVENTS.SERVER.PLAYER_READY, {
        position: seat?.seatPosition ?? -1,
        ready: data.ready,
      });
      _broadcastRoomState(io, roomId);
      await _maybeAutoStartNextHand(io, roomId);
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.BORROW_CHIPS, async () => {
    try {
      const roomId = await currentRoomId();
      if (!roomId) return;

      const result = await roomManager.borrowChips(roomId, player.id);
      if (!result.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: result.error });
      }

      // Also auto-lend to any broke AI so they don't block the next hand.
      await roomManager.autoLendToBrokeAI(roomId);

      socket.emit(EVENTS.SERVER.ROOM_SETTLEMENT, {
        roomId,
        settlement: result.settlement,
        type: 'borrow',
      });
      _broadcastRoomState(io, roomId);
      await _maybeAutoStartNextHand(io, roomId);
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.ADD_AI, async () => {
    try {
      const roomId = await currentRoomId();
      if (!roomId) return;

      const room = await roomManager.getRoom(roomId);
      if (!room || !roomManager._canControlRoom(room, player.id)) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'Only host can add AI' });
      }

      const result = await roomManager.addAI(roomId, aiManager);
      if (!result.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: result.error });
      }

      _broadcastRoomState(io, roomId);
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.REMOVE_AI, async (data: any = {}) => {
    try {
      const roomId = await currentRoomId();
      if (!roomId) return;

      const room = await roomManager.getRoom(roomId);
      if (!room || !roomManager._canControlRoom(room, player.id)) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'Only host can remove AI' });
      }

      const position = Number(data.position);
      if (!Number.isInteger(position)) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'Seat position required' });
      }

      const result = await roomManager.removeAI(roomId, position, aiManager);
      if (!result.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: result.error });
      }

      io.to(roomId).emit(EVENTS.SERVER.PLAYER_LEFT, { position });
      _broadcastRoomState(io, roomId);
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.UPDATE_NICKNAME, async (data: any = {}) => {
    try {
      const result = await playerManager.updateNickname(player.id, data.nickname);
      if (!result.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: result.error });
      }

      player.nickname = result.player.nickname;
      socket.emit(EVENTS.SERVER.PLAYER_UPDATED, { player: result.player });

      if (result.roomId) {
        io.to(result.roomId).emit(EVENTS.SERVER.PLAYER_UPDATED, {
          playerId: player.id,
          player: result.player,
        });
        // player:updated + room:state carry the new nickname. A null-viewer
        // game:state must NOT be broadcast here: it wiped every client's
        // hole cards and valid actions mid-hand.
        await _broadcastRoomState(io, result.roomId);
      }
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.START_GAME, async () => {
    try {
      const roomId = await currentRoomId();
      if (!roomId) return;

      const room = await roomManager.getRoom(roomId);
      if (!room || !roomManager._canControlRoom(room, player.id)) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'Only host can start' });
      }

      // Fill with AI if allowed
      if (room.allowAI) {
        await aiManager.fillRoomWithAI(roomId);
      }

      const canStart = await roomManager.canStart(roomId);
      if (!canStart) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'Not all seated players are ready' });
      }

      const start = await _startHandForRoom(io, roomId, player.id);
      if (!start.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: start.error });
      }
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  // ─── Game Events ─────────────────────────────────────────────

  socket.on(EVENTS.CLIENT.GAME_ACTION, async (data: any = {}) => {
    try {
      const roomId = await currentRoomId();
      if (!roomId) return;

      // Simple per-player throttle
      const now = Date.now();
      if (player._lastActionAt && now - player._lastActionAt < 300) {
        return;
      }
      player._lastActionAt = now;

      const validTypes = ['fold', 'check', 'call', 'raise', 'bet', 'allin'];
      const type = data.type;
      if (!validTypes.includes(type)) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'Invalid action type' });
      }

      const amount = data.amount != null ? Number(data.amount) : 0;
      if (!Number.isFinite(amount)) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'Invalid amount' });
      }

      const beforeGame = await gameEngine.getGameState(roomId, null);
      const result = await gameEngine.handleAction(roomId, player.id, type, amount);
      if (!result.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: result.error });
      }

      const afterGame = result.game;
      await _broadcastActionOutcome(io, roomId, beforeGame, afterGame, {
        position: beforeGame?.players.find(p => p.playerId === player.id)?.seatPosition,
        type,
        amount,
      });
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.REQUEST_STATE, async () => {
    try {
      const roomId = await currentRoomId();
      if (!roomId) return;

      const roomState = await roomManager.getRoom(roomId);
      if (roomState) {
        socket.emit(EVENTS.SERVER.ROOM_STATE, {
          room: roomManager._sanitizeRoom(roomState),
        });
      }

      const gameState = await gameEngine.getGameState(roomId, player.id);
      if (gameState) {
        socket.emit(EVENTS.SERVER.GAME_STATE, { gameState });
      }

      // Restore the private turn snapshot when the requester is the one to
      // act, so a mid-turn reconnect does not strand them without actions.
      await _resendTurnToPlayer(socket, roomId, player.id);
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  // ─── Chat ────────────────────────────────────────────────────

  socket.on(EVENTS.CLIENT.CHAT_MESSAGE, async (data: any = {}) => {
    try {
      const roomId = await currentRoomId();
      if (!roomId) return;

      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text || text.length > 200) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'Invalid message' });
      }

      io.to(roomId).emit(EVENTS.SERVER.CHAT_MESSAGE, {
        from: player.nickname,
        text,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  // ─── Disconnect ──────────────────────────────────────────────

  socket.on('disconnect', async (reason: any) => {
    console.log('[Socket] Client disconnected:', socket.id, reason);

    try {
      const currentPlayer = await playerManager.getPlayerById(player.id);
      if (currentPlayer && currentPlayer.socketId && currentPlayer.socketId !== socket.id) {
        console.log('[Socket] Player reconnected with new socket, skip leaveRoom');
        return;
      }

      await playerManager.disconnectPlayer(player.id);

      const roomId = await currentRoomId();
      if (roomId) {
        const room = await roomManager.getRoom(roomId);
        const seatPosition = room?.players.find(p => p.playerId === player.id)?.seatPosition ?? -1;

        if (room) {
          if (disconnectTimers.has(player.id)) {
            clearTimeout(disconnectTimers.get(player.id));
          }

          const timer = setTimeout(async () => {
            disconnectTimers.delete(player.id);
            const stillOffline = !(await playerManager.getPlayerById(player.id))?.isOnline;
            if (stillOffline) {
              const result = await roomManager.leaveRoom(roomId, player.id);
              if (!result.success) return;
              if (result.hostLeft) {
                io.to(roomId).emit(EVENTS.SERVER.ROOM_SETTLED, {
                  roomId,
                  settlements: result.settlements,
                  roomDeleted: true,
                  reason: 'host_left',
                });
                return;
              }
              io.to(roomId).emit(EVENTS.SERVER.PLAYER_LEFT, { position: seatPosition });
              _broadcastRoomState(io, roomId);
            }
          }, DISCONNECT_TIMEOUT_MS);
          if (typeof timer.unref === 'function') timer.unref();
          disconnectTimers.set(player.id, timer);
        }
      }
    } catch (err) {
      console.error('[Socket] Disconnect handler error:', err);
    }
  });
}

// ─── Helper Functions ────────────────────────────────────────────

async function _broadcastActionOutcome(io: any, roomId: string, beforeGame: any, afterGame: any, actionPayload: any): Promise<void> {
  for (const item of _buildActionProgressEvents(beforeGame, afterGame, actionPayload)) {
    io.to(roomId).emit(item.event, item.payload);
  }

  if (afterGame.status === 'showdown' || afterGame.status === 'ended') {
    _cancelTurnTimer(roomId);
    await _broadcastShowdownAndEnd(io, roomId, afterGame);
    await _broadcastRoomState(io, roomId);
  } else {
    await _broadcastGameTurn(io, roomId);
  }
}

function _buildActionProgressEvents(beforeGame: any, afterGame: any, actionPayload: any): Array<{ event: string; payload: any }> {
  const events: Array<{ event: string; payload: any }> = [
    {
      event: EVENTS.SERVER.GAME_ACTION,
      payload: actionPayload,
    },
    {
      event: EVENTS.SERVER.GAME_POT,
      payload: {
        mainPot: afterGame.pots.mainPot,
        sidePots: afterGame.pots.sidePots,
        totalPot: afterGame.totalPot,
        players: (afterGame.players || []).map((p: any) => ({
          playerId: p.playerId,
          position: p.seatPosition,
          chips: p.chips,
          bet: p.bet,
          totalBet: p.totalBet,
          allIn: p.allIn,
        })),
      },
    },
  ];

  const beforeCards = beforeGame?.communityCards || [];
  const afterCards = afterGame?.communityCards || [];
  if (afterCards.length > beforeCards.length) {
    events.push({
      event: EVENTS.SERVER.GAME_COMMUNITY,
      payload: {
        cards: afterCards,
        round: _roundNameFromStatus(afterGame.status),
      },
    });
  }

  if (!_hasPublicShowdownCards(beforeGame) && _hasPublicShowdownCards(afterGame)) {
    events.push({
      event: EVENTS.SERVER.GAME_SHOWDOWN,
      payload: {
        results: _buildVisibleHoleCardResults(afterGame),
      },
    });
  }

  return events;
}

async function _broadcastShowdownAndEnd(io: any, roomId: string, afterGame: any): Promise<void> {
  const fullState = await gameEngine.getGameState(roomId, null);
  const results = fullState?.showdownResults || [];

  io.to(roomId).emit(EVENTS.SERVER.GAME_SHOWDOWN, { results });
  io.to(roomId).emit(EVENTS.SERVER.GAME_ENDED, {
    winners: afterGame.winners,
    handResults: afterGame.handResults,
    nextHandDelay: 5000,
  });
}

async function _startHandForRoom(io: any, roomId: string, starterId: string): Promise<{ success: boolean; error?: string }> {
  const startResult = await roomManager.startGame(roomId, starterId);
  if (!startResult.success) {
    return { success: false, error: startResult.error };
  }

  const result = await gameEngine.startGame(roomId);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const game = result.game;

  io.to(roomId).emit(EVENTS.SERVER.GAME_STARTED, {
    gameId: roomId,
    dealer: game.dealerPosition,
    sb: game.smallBlindPos,
    bb: game.bigBlindPos,
  });

  const privateDeals = await gameEngine.getPrivateDeals(roomId);
  for (const deal of privateDeals) {
    const socketId = await store.getSocketByPlayerId(deal.playerId);
    if (socketId) {
      io.to(socketId).emit(EVENTS.SERVER.GAME_DEALT, {
        cards: deal.cards,
        position: deal.position,
      });
    }
  }

  await _broadcastRoomState(io, roomId);
  await _broadcastGameTurn(io, roomId);
  return { success: true };
}

async function _maybeAutoStartNextHand(io: any, roomId: string): Promise<boolean> {
  const room = await roomManager.getRoom(roomId);
  if (!room || !room.awaitingNextHandReady || room.status !== 'waiting') return false;

  // Ensure broke AI get lent chips before checking start conditions.
  await roomManager.autoLendToBrokeAI(roomId);

  if (!(await roomManager.canStart(roomId))) return false;

  const starter = room.hostId || room.players.find(p => p.seatPosition >= 0)?.playerId;
  if (!starter) return false;

  const result = await _startHandForRoom(io, roomId, starter);
  return result.success;
}

async function _broadcastRoomState(io: any, roomId: string): Promise<void> {
  const room = await roomManager.getRoom(roomId);
  if (!room) return;
  io.to(roomId).emit(EVENTS.SERVER.ROOM_STATE, {
    room: roomManager._sanitizeRoom(room),
  });
}

async function _broadcastGameTurn(io: any, roomId: string): Promise<void> {
  const game = await gameEngine.getGameState(roomId, null);
  if (!game || game.status === 'ended') return;

  const currentPlayer = game.players.find(p => p.seatPosition === game.currentPosition);
  if (!currentPlayer || currentPlayer.folded || currentPlayer.allIn) return;

  const timeoutAt = Date.now() + ACTION_TIMEOUT_MS;
  await _gateTurnScheduling(io, roomId, game, currentPlayer, timeoutAt);

  // Send valid actions only to current player
  const validActions = await gameEngine.getValidActions(roomId, currentPlayer.playerId);
  const socketId = await store.getSocketByPlayerId(currentPlayer.playerId);
  if (socketId) {
    io.to(socketId).emit(EVENTS.SERVER.GAME_TURN, {
      position: currentPlayer.seatPosition,
      timeoutAt,
      validActions,
      currentBet: game.currentBet,
      minRaise: game.minRaise,
      totalPot: game.totalPot,
    });
  }

  // Broadcast turn to everyone
  io.to(roomId).emit(EVENTS.SERVER.GAME_TURN, {
    position: currentPlayer.seatPosition,
    timeoutAt,
    currentBet: game.currentBet,
    minRaise: game.minRaise,
    totalPot: game.totalPot,
  });
}

// Scheduling side effects (turn timer + AI decision) run on exactly one
// instance per room. Single-instance (scheduler == null): always local,
// unchanged. Multi-instance: the lock owner schedules; a non-owner
// publishes a turn signal so the owner schedules against the shared state.
async function _gateTurnScheduling(io: any, roomId: string, game: any, currentPlayer: any, timeoutAt: number): Promise<void> {
  if (!scheduler) {
    await _scheduleForTurn(io, roomId, game, currentPlayer, timeoutAt);
    return;
  }
  // A Redis hiccup must not break the client-facing broadcast chain: the
  // action already took effect and was persisted. A skipped schedule is
  // fail-safe (at worst no timer until the next scheduling point — never
  // two schedulers), so log and let the broadcast continue.
  try {
    if (await scheduler.claim(roomId)) {
      await _scheduleForTurn(io, roomId, game, currentPlayer, timeoutAt);
    } else {
      await scheduler.notifyTurn(roomId, {
        seatPosition: currentPlayer.seatPosition,
        playerId: currentPlayer.playerId,
        timeoutAt,
      });
    }
  } catch (err) {
    console.error('[Scheduler] Turn scheduling failed (broadcast continues):', err);
  }
}

// Turn timer + AI scheduling for one turn. Runs only on the room's owner
// (or on the single instance when no scheduler is wired).
async function _scheduleForTurn(io: any, roomId: string, game: any, currentPlayer: any, timeoutAt: number): Promise<void> {
  await _scheduleTurnTimeout(io, roomId, {
    seatPosition: currentPlayer.seatPosition,
    playerId: currentPlayer.playerId,
  }, timeoutAt);

  if (scheduler) {
    // Shared snapshot so a mid-turn re-sync landing on a non-owner
    // instance can still be re-sent the original deadline.
    await scheduler.writeTurnSnapshot(roomId, {
      seatPosition: currentPlayer.seatPosition,
      playerId: currentPlayer.playerId,
      timeoutAt,
    });
  }

  const currentUser = await playerManager.getPlayerById(currentPlayer.playerId);
  if (currentUser?.isAI) {
    // Schedule at most one AI decision per distinct turn (INV3). The key
    // changes with street, actor and bet level, so duplicate broadcasts
    // for the same turn are ignored while genuine re-turns (e.g. after a
    // re-raise) still schedule. Check-and-set is synchronous.
    const turnKey = `${game.status}:${currentPlayer.seatPosition}:${game.currentBet}:${currentPlayer.bet}`;
    if (aiSchedules.get(roomId) !== turnKey) {
      aiSchedules.set(roomId, turnKey);
      _scheduleAiDecision(io, roomId, game, currentPlayer, turnKey).catch(err => {
        console.error('[Socket] AI action error:', err);
      });
    }
  }
}

// Turn signal received over the scheduler bus. claim() doubles as the
// renewal for a live owner and as the takeover acquire once a dead
// owner's lock has expired; the loser(s) of the claim simply skip, so the
// turn is still scheduled exactly once cluster-wide. A stale signal
// (turn already moved on) is dropped against the shared game state.
async function _onTurnSignal(io: any, roomId: string, turn: any): Promise<void> {
  if (!scheduler) return;
  // Drop signals whose deadline already elapsed: scheduling them would
  // fire an immediate fold (delayMs clamps to 0), and a late duplicate of
  // a previous turn could otherwise fold a player's fresh turn. The next
  // scheduling point rebuilds the timeout with a full deadline anyway.
  if (typeof turn.timeoutAt !== 'number' || turn.timeoutAt <= Date.now()) return;
  if (!(await scheduler.claim(roomId))) return;

  const game = await gameEngine.getGameState(roomId, null);
  if (!game || game.status === 'ended') return;
  if (game.currentPosition !== turn.seatPosition || game.currentPlayerId !== turn.playerId) {
    return;
  }

  const currentPlayer = game.players.find(p => p.seatPosition === game.currentPosition);
  if (!currentPlayer || currentPlayer.folded || currentPlayer.allIn) return;

  await _scheduleForTurn(io, roomId, game, currentPlayer, turn.timeoutAt);
}

// Re-send the private turn snapshot (valid actions + original deadline) to a
// player who re-syncs state while it is their turn. The armed timer's
// timeoutAt is reused as-is: a state refresh must never restart the
// countdown, re-broadcast the public turn, or re-schedule the AI.
// Multi-instance: the timer lives on the room's owner instance, so a
// re-sync landing elsewhere falls back to the shared turn snapshot.
async function _resendTurnToPlayer(socket: any, roomId: string, playerId: string): Promise<void> {
  const entry = turnTimers.get(roomId);
  let timeoutAt: number | null = entry && entry.playerId === playerId ? entry.timeoutAt : null;

  if (timeoutAt == null && scheduler) {
    const snap = await scheduler.readTurnSnapshot(roomId);
    if (snap && snap.playerId === playerId) {
      timeoutAt = snap.timeoutAt;
    }
  }
  if (timeoutAt == null) return;

  const game = await gameEngine.getGameState(roomId, playerId);
  if (!game || game.status === 'ended' || game.currentPlayerId !== playerId) return;

  const currentPlayer = game.players.find((p: any) => p.playerId === playerId);
  if (!currentPlayer || currentPlayer.folded || currentPlayer.allIn) return;

  const validActions = await gameEngine.getValidActions(roomId, playerId);
  socket.emit(EVENTS.SERVER.GAME_TURN, {
    position: currentPlayer.seatPosition,
    timeoutAt,
    validActions,
    currentBet: game.currentBet,
    minRaise: game.minRaise,
    totalPot: game.totalPot,
  });
}

async function _scheduleAiDecision(io: any, roomId: string, game: any, currentPlayer: any, turnKey: string): Promise<void> {
  // Typed as any: the decision context (or null) flows into the AI services
  // exactly like the JS version did; null handling stays a runtime concern.
  const aiGameState: any = await gameEngine.getAIDecisionContext(roomId, currentPlayer.playerId);

  // Avoid costly LLM calls when no human is left in the hand
  const otherPlayers = game.players.filter((p: any) => !p.folded && p.playerId !== currentPlayer.playerId);
  const otherUsers = await Promise.all(otherPlayers.map((p: any) => playerManager.getPlayerById(p.playerId)));
  const hasHumanInHand = otherUsers.some(u => u && !u.isAI);

  const decision = hasHumanInHand
    ? await aiManager.decide(aiGameState, currentPlayer.playerId)
    : aiManager.decideWithRules(aiGameState, currentPlayer.playerId);

  setTimeout(async () => {
    try {
      // Re-validate before acting: drop the decision when the turn has
      // moved on or a newer schedule superseded this one (INV3).
      const beforeGame = await gameEngine.getGameState(roomId, null);
      const stillCurrent = beforeGame && beforeGame.status !== 'ended'
        && beforeGame.currentPosition === currentPlayer.seatPosition
        && beforeGame.currentPlayerId === currentPlayer.playerId;
      const mine = aiSchedules.get(roomId) === turnKey;
      if (mine) aiSchedules.delete(roomId);
      if (!stillCurrent || !mine) return;

      const result = await gameEngine.handleAction(
        roomId,
        currentPlayer.playerId,
        decision.type,
        decision.amount
      );
      if (result.success) {
        await _broadcastActionOutcome(io, roomId, beforeGame, result.game, {
          position: currentPlayer.seatPosition,
          type: decision.type,
          amount: decision.amount,
        });
      }
    } catch (err) {
      console.error('[Socket] AI action error:', err);
    }
  }, decision.delayMs);
}

async function _scheduleTurnTimeout(io: any, roomId: string, currentPlayer: any, timeoutAt: number): Promise<void> {
  const game = await store.getGame(roomId);
  if (!game || !currentPlayer) {
    // Silently dropping the timer would leave the turn unprotected.
    console.warn('[Socket] Turn timer skipped: no active game for room', roomId);
    return;
  }

  // One effective timer per room: arming a new turn supersedes the old one.
  _cancelTurnTimer(roomId);

  const expected = {
    seatPosition: currentPlayer.seatPosition,
    playerId: currentPlayer.playerId,
  };
  const delayMs = Math.max(0, timeoutAt - Date.now());
  const timer = setTimeout(async () => {
    try {
      // A superseded timer must never fold: the stored handle IS the
      // generation check (INV2).
      const entry = turnTimers.get(roomId);
      if (!entry || entry.timer !== timer) return;
      turnTimers.delete(roomId);

      await _autoFoldTimedOutPlayer(io, roomId, expected);
    } catch (err) {
      console.error('[Socket] Turn timeout error:', err);
    }
  }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();

  // timeoutAt is stored so a player who re-syncs mid-turn can be re-sent the
  // original deadline instead of a freshly restarted countdown.
  turnTimers.set(roomId, { timer, timeoutAt, ...expected });
}

function _cancelTurnTimer(roomId: string): void {
  const entry = turnTimers.get(roomId);
  if (entry) {
    clearTimeout(entry.timer);
    turnTimers.delete(roomId);
  }
}

// Test-only visibility into the scheduler layer (multi-instance tests
// assert a non-owner instance arms no local timer).
function _hasTurnTimer(roomId: string): boolean {
  return turnTimers.has(roomId);
}

async function _autoFoldTimedOutPlayer(io: any, roomId: string, expected: any): Promise<boolean> {
  const beforeGame = await gameEngine.getGameState(roomId, null);
  if (!beforeGame || beforeGame.status === 'ended') return false;
  if (
    beforeGame.currentPosition !== expected.seatPosition ||
    beforeGame.currentPlayerId !== expected.playerId
  ) {
    return false;
  }

  const result = await gameEngine.timeoutFold(roomId, expected.seatPosition);
  if (!result.success) return false;

  await _broadcastActionOutcome(io, roomId, beforeGame, result.game, {
    position: expected.seatPosition,
    type: 'fold',
    amount: 0,
    reason: 'timeout',
  });
  return true;
}

function _roundNameFromStatus(status: string): string {
  if (status === 'preflop') return 'preflop';
  if (status === 'flop') return 'flop';
  if (status === 'turn') return 'turn';
  if (status === 'river') return 'river';
  return status;
}

function _hasPublicShowdownCards(game: any): boolean {
  if (!game) return false;

  const hasShowdownResult = Array.isArray(game.showdownResults) && game.showdownResults.length > 0;
  const isShowdownState = game.status === 'showdown' || game.status === 'ended';
  if (!hasShowdownResult && !isShowdownState) return false;

  if (hasShowdownResult) {
    return game.showdownResults.some((r: any) => Array.isArray(r.cards) && r.cards.length === 2);
  }

  return Boolean(game.players?.some((p: any) => !p.folded && Array.isArray(p.holeCards) && p.holeCards.length === 2));
}

function _buildVisibleHoleCardResults(game: any): any[] {
  if (game?.showdownResults) {
    return game.showdownResults.map((r: any) => ({
      position: r.position,
      playerId: r.playerId,
      cards: r.cards,
      handName: r.handName,
    }));
  }

  return (game?.players || [])
    .filter((p: any) => !p.folded && Array.isArray(p.holeCards) && p.holeCards.length === 2)
    .map((p: any) => ({
      position: p.seatPosition,
      playerId: p.playerId,
      cards: p.holeCards,
      handName: null,
    }));
}

function _buildConnectedPayload(player: any, token?: string): { playerId: string; player: { id: string; nickname: string; avatar: string; chips: number }; token?: string } {
  const payload: { playerId: string; player: { id: string; nickname: string; avatar: string; chips: number }; token?: string } = {
    playerId: player.id,
    player: {
      id: player.id,
      nickname: player.nickname,
      avatar: player.avatar,
      chips: player.chips,
    },
  };
  if (token) {
    payload.token = token;
  }
  return payload;
}

module.exports = {
  setupSocketHandlers,
  _buildActionProgressEvents,
  _buildConnectedPayload,
  _maybeAutoStartNextHand,
  _scheduleTurnTimeout,
  _cancelTurnTimer,
  _hasTurnTimer,
  _broadcastGameTurn,
};
