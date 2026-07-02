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

  socket.emit(EVENTS.SERVER.CONNECTED || 'connected', _buildConnectedPayload(player));

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
      await _maybeAutoStartNextHand(io, roomId);
    } catch (err) {
      socket.emit(EVENTS.SERVER.ERROR, { error: err.message });
    }
  });

  socket.on(EVENTS.CLIENT.BORROW_CHIPS, async () => {
    try {
      const roomId = player.currentRoom;
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

  socket.on(EVENTS.CLIENT.UPDATE_NICKNAME, async (data = {}) => {
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
        await _broadcastRoomState(io, result.roomId);
        const gameState = await gameEngine.getGameState(result.roomId, null);
        if (gameState) {
          io.to(result.roomId).emit(EVENTS.SERVER.GAME_STATE, { gameState });
        }
      }
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

      const start = await _startHandForRoom(io, roomId, player.id);
      if (!start.success) {
        return socket.emit(EVENTS.SERVER.ERROR, { error: start.error });
      }
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
              const result = await roomManager.leaveRoom(roomId, player.id);
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
          disconnectTimers.set(player.id, timer);
        } else {
          const result = await roomManager.leaveRoom(roomId, player.id);
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
    await _broadcastRoomState(io, roomId);
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
        players: (afterGame.players || []).map(p => ({
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

async function _broadcastShowdownAndEnd(io, roomId, afterGame) {
  const fullState = await gameEngine.getGameState(roomId, null);
  const results = fullState?.showdownResults || [];

  io.to(roomId).emit(EVENTS.SERVER.GAME_SHOWDOWN, { results });
  io.to(roomId).emit(EVENTS.SERVER.GAME_ENDED, {
    winners: afterGame.winners,
    handResults: afterGame.handResults,
    nextHandDelay: 5000,
  });
}

async function _startHandForRoom(io, roomId, starterId) {
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

async function _maybeAutoStartNextHand(io, roomId) {
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
  await _scheduleTurnTimeout(io, roomId, {
    seatPosition: currentPlayer.seatPosition,
    playerId: currentPlayer.playerId,
  }, timeoutAt);

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

async function _scheduleTurnTimeout(io, roomId, currentPlayer, timeoutAt) {
  const game = await store.getGame(roomId);
  if (!game || !currentPlayer) return;

  if (game.timeoutId) {
    clearTimeout(game.timeoutId);
    game.timeoutId = null;
  }

  const expected = {
    seatPosition: currentPlayer.seatPosition,
    playerId: currentPlayer.playerId,
  };
  const delayMs = Math.max(0, timeoutAt - Date.now());
  const timeoutId = setTimeout(async () => {
    try {
      const liveGame = await store.getGame(roomId);
      if (!liveGame || liveGame.timeoutId !== timeoutId) return;

      await _autoFoldTimedOutPlayer(io, roomId, expected);
    } catch (err) {
      console.error('[Socket] Turn timeout error:', err);
    }
  }, delayMs);

  game.timeoutId = timeoutId;
}

async function _autoFoldTimedOutPlayer(io, roomId, expected) {
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

function _roundNameFromStatus(status) {
  if (status === 'preflop') return 'preflop';
  if (status === 'flop') return 'flop';
  if (status === 'turn') return 'turn';
  if (status === 'river') return 'river';
  return status;
}

function _hasPublicShowdownCards(game) {
  if (!game) return false;

  const hasShowdownResult = Array.isArray(game.showdownResults) && game.showdownResults.length > 0;
  const isShowdownState = game.status === 'showdown' || game.status === 'ended';
  if (!hasShowdownResult && !isShowdownState) return false;

  if (hasShowdownResult) {
    return game.showdownResults.some(r => Array.isArray(r.cards) && r.cards.length === 2);
  }

  return Boolean(game.players?.some(p => !p.folded && Array.isArray(p.holeCards) && p.holeCards.length === 2));
}

function _buildVisibleHoleCardResults(game) {
  if (game?.showdownResults) {
    return game.showdownResults.map(r => ({
      position: r.position,
      playerId: r.playerId,
      cards: r.cards,
      handName: r.handName,
    }));
  }

  return (game?.players || [])
    .filter(p => !p.folded && Array.isArray(p.holeCards) && p.holeCards.length === 2)
    .map(p => ({
      position: p.seatPosition,
      playerId: p.playerId,
      cards: p.holeCards,
      handName: null,
    }));
}

function _buildConnectedPayload(player) {
  return {
    playerId: player.id,
    player: {
      id: player.id,
      nickname: player.nickname,
      avatar: player.avatar,
      chips: player.chips,
    },
  };
}

module.exports = {
  setupSocketHandlers,
  _buildActionProgressEvents,
  _buildConnectedPayload,
  _maybeAutoStartNextHand,
  _scheduleTurnTimeout,
};
