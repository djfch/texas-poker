/**
 * backend/socket/handlers.js - Socket.IO Event Handlers
 *
 * Handles all real-time game events.
 */

const playerManager = require('../services/player-manager');
const roomManager = require('../services/room-manager');
const gameEngine = require('../services/game-engine');
const aiManager = require('../services/ai-manager');
const store = require('../storage/memory-store');
const { ACTION_TIMEOUT_MS, DISCONNECT_TIMEOUT_MS } = require('../config/constants');
const EVENTS = require('./events');

// Map playerId -> disconnect timeout
const disconnectTimers = new Map();

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log('[Socket] Client connected:', socket.id);

    handleConnection(socket, io).catch(err => {
      console.error('[Socket] Connection handler error:', err);
      socket.emit(EVENTS.SERVER.ERROR, { error: 'Internal error' });
    });
  });
}

async function handleConnection(socket, io) {
  // Try to restore player from query or create new guest
  let player = null;
  const queryPlayerId = socket.handshake.query.playerId;

  if (queryPlayerId) {
    player = await playerManager.getPlayerById(queryPlayerId);
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
      }
    }
  }

  if (!player) {
    player = await playerManager.getPlayerBySocket(socket.id);
    if (!player) {
      player = await playerManager.createGuest(socket.id);
    } else {
      await playerManager.setPlayerSocket(player.id, socket.id);
    }
  }

  socket.emit(EVENTS.SERVER.CONNECTED || 'connected', { playerId: player.id });

  // If the client supplied an unknown playerId, tell them to re-create
  if (queryPlayerId && !player) {
    socket.emit(EVENTS.SERVER.ERROR, {
      code: 'PLAYER_UNKNOWN',
      error: 'Player session expired, please re-create',
    });
  }

  // ─── Room Events ─────────────────────────────────────────────

  socket.on(EVENTS.CLIENT.JOIN_ROOM, async (data = {}) => {
    try {
      const { roomId, password } = data;
      if (!roomId || typeof roomId !== 'string') {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'Room ID required' });
      }

      const result = await roomManager.joinRoom(roomId, player.id, password);
      if (!result.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: result.error });
      }

      socket.join(roomId);

      const room = await roomManager.getRoom(roomId);
      const seat = room.players.find(p => p.playerId === player.id);

      io.to(roomId).emit(EVENTS.SERVER.PLAYER_JOINED, {
        seat: {
          position: seat.seatPosition,
          playerId: player.id,
          nickname: player.nickname,
          avatar: player.avatar,
          isReady: seat.isReady,
        },
      });

      _broadcastRoomState(io, roomId);
    } catch (err) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.LEAVE_ROOM, async () => {
    try {
      const roomId = player.currentRoom;
      if (!roomId) return;

      const roomBefore = await roomManager.getRoom(roomId);
      const seatPosition = roomBefore?.players.find(p => p.playerId === player.id)?.seatPosition ?? -1;

      await roomManager.leaveRoom(roomId, player.id);
      socket.leave(roomId);

      io.to(roomId).emit(EVENTS.SERVER.PLAYER_LEFT, { position: seatPosition });
      _broadcastRoomState(io, roomId);
    } catch (err) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.SIT, async (data = {}) => {
    try {
      const roomId = player.currentRoom;
      if (!roomId) return;
      if (data.position == null || typeof data.position !== 'number') {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'Seat position required' });
      }

      const result = await roomManager.sit(roomId, player.id, data.position);
      if (!result.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: result.error });
      }

      _broadcastRoomState(io, roomId);
    } catch (err) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.STAND, async () => {
    try {
      const roomId = player.currentRoom;
      if (!roomId) return;

      const result = await roomManager.stand(roomId, player.id);
      if (!result.success) return;

      _broadcastRoomState(io, roomId);
    } catch (err) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.READY, async (data = {}) => {
    try {
      const roomId = player.currentRoom;
      if (!roomId) return;
      if (typeof data.ready !== 'boolean') {
        return socket.emit(EVENTS.SERVER.ERROR, { error: 'ready must be boolean' });
      }

      const result = await roomManager.ready(roomId, player.id, data.ready);
      if (!result.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: result.error });
      }

      const room = await roomManager.getRoom(roomId);
      const seat = room.players.find(p => p.playerId === player.id);

      io.to(roomId).emit(EVENTS.SERVER.PLAYER_READY, {
        position: seat?.seatPosition ?? -1,
        ready: data.ready,
      });
      _broadcastRoomState(io, roomId);
    } catch (err) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.ADD_AI, async () => {
    try {
      const roomId = player.currentRoom;
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
    } catch (err) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.REMOVE_AI, async (data = {}) => {
    try {
      const roomId = player.currentRoom;
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
    } catch (err) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.START_GAME, async () => {
    try {
      const roomId = player.currentRoom;
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

      const startResult = await roomManager.startGame(roomId, player.id);
      if (!startResult.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: startResult.error });
      }

      const result = await gameEngine.startGame(roomId);
      if (!result.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: result.error });
      }

      const game = result.game;

      io.to(roomId).emit(EVENTS.SERVER.GAME_STARTED, {
        gameId: roomId,
        dealer: game.dealerPosition,
        sb: game.smallBlindPos,
        bb: game.bigBlindPos,
      });

      // Send private hole cards to each player.
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

      _broadcastRoomState(io, roomId);
      await _broadcastGameTurn(io, roomId);
    } catch (err) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  // ─── Game Events ─────────────────────────────────────────────

  socket.on(EVENTS.CLIENT.GAME_ACTION, async (data = {}) => {
    try {
      const roomId = player.currentRoom;
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
    } catch (err) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.REQUEST_STATE, async () => {
    try {
      const roomId = player.currentRoom;
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
    } catch (err) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  // ─── Chat ────────────────────────────────────────────────────

  socket.on(EVENTS.CLIENT.CHAT_MESSAGE, async (data = {}) => {
    try {
      const roomId = player.currentRoom;
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
    } catch (err) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  // ─── Disconnect ──────────────────────────────────────────────

  socket.on('disconnect', async (reason) => {
    console.log('[Socket] Client disconnected:', socket.id, reason);

    try {
      const currentPlayer = await playerManager.getPlayerById(player.id);
      if (currentPlayer && currentPlayer.socketId && currentPlayer.socketId !== socket.id) {
        console.log('[Socket] Player reconnected with new socket, skip leaveRoom');
        return;
      }

      await playerManager.disconnectPlayer(player.id);

      const roomId = player.currentRoom;
      if (roomId) {
        const room = await roomManager.getRoom(roomId);
        const seatPosition = room?.players.find(p => p.playerId === player.id)?.seatPosition ?? -1;

        // If game is playing, give reconnect window; otherwise leave immediately
        if (room?.status === 'playing') {
          const timer = setTimeout(async () => {
            disconnectTimers.delete(player.id);
            const stillOffline = !(await playerManager.getPlayerById(player.id))?.isOnline;
            if (stillOffline) {
              await roomManager.leaveRoom(roomId, player.id);
              io.to(roomId).emit(EVENTS.SERVER.PLAYER_LEFT, { position: seatPosition });
              _broadcastRoomState(io, roomId);
            }
          }, DISCONNECT_TIMEOUT_MS);
          disconnectTimers.set(player.id, timer);
        } else {
          await roomManager.leaveRoom(roomId, player.id);
          io.to(roomId).emit(EVENTS.SERVER.PLAYER_LEFT, { position: seatPosition });
          _broadcastRoomState(io, roomId);
        }
      }
    } catch (err) {
      console.error('[Socket] Disconnect handler error:', err);
    }
  });
}

// ─── Helper Functions ────────────────────────────────────────────

async function _broadcastActionOutcome(io, roomId, beforeGame, afterGame, actionPayload) {
  for (const item of _buildActionProgressEvents(beforeGame, afterGame, actionPayload)) {
    io.to(roomId).emit(item.event, item.payload);
  }

  if (afterGame.status === 'showdown' || afterGame.status === 'ended') {
    await _broadcastShowdownAndEnd(io, roomId, afterGame);
  } else {
    await _broadcastGameTurn(io, roomId);
  }
}

function _buildActionProgressEvents(beforeGame, afterGame, actionPayload) {
  const events = [
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

  return events;
}

async function _broadcastShowdownAndEnd(io, roomId, afterGame) {
  const fullState = await gameEngine.getGameState(roomId, null);
  const results = fullState.players
    .filter(p => !p.folded)
    .map(p => ({
      position: p.seatPosition,
      cards: p.holeCards,
      handName: null,
    }));

  io.to(roomId).emit(EVENTS.SERVER.GAME_SHOWDOWN, { results });
  io.to(roomId).emit(EVENTS.SERVER.GAME_ENDED, {
    winners: afterGame.winners,
    nextHandDelay: 5000,
  });
}

async function _broadcastRoomState(io, roomId) {
  const room = await roomManager.getRoom(roomId);
  if (!room) return;
  io.to(roomId).emit(EVENTS.SERVER.ROOM_STATE, {
    room: roomManager._sanitizeRoom(room),
  });
}

async function _broadcastGameTurn(io, roomId) {
  const game = await gameEngine.getGameState(roomId, null);
  if (!game || game.status === 'ended') return;

  const currentPlayer = game.players.find(p => p.seatPosition === game.currentPosition);
  if (!currentPlayer || currentPlayer.folded || currentPlayer.allIn) return;

  const timeoutAt = Date.now() + ACTION_TIMEOUT_MS;

  // If AI, schedule its decision
  const currentUser = await playerManager.getPlayerById(currentPlayer.playerId);
  if (currentUser?.isAI) {
    const aiGameState = await gameEngine.getAIDecisionContext(roomId, currentPlayer.playerId);

    // Avoid costly LLM calls when no human is left in the hand
    const otherPlayers = game.players.filter(p => !p.folded && p.playerId !== currentPlayer.playerId);
    const otherUsers = await Promise.all(otherPlayers.map(p => playerManager.getPlayerById(p.playerId)));
    const hasHumanInHand = otherUsers.some(u => u && !u.isAI);

    const decision = hasHumanInHand
      ? await aiManager.decide(aiGameState, currentPlayer.playerId)
      : aiManager.decideWithRules(aiGameState, currentPlayer.playerId);

    setTimeout(async () => {
      try {
        const beforeGame = await gameEngine.getGameState(roomId, null);
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

function _roundNameFromStatus(status) {
  if (status === 'preflop') return 'preflop';
  if (status === 'flop') return 'flop';
  if (status === 'turn') return 'turn';
  if (status === 'river') return 'river';
  return status;
}

module.exports = {
  setupSocketHandlers,
  _buildActionProgressEvents,
};
