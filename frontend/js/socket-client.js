/**
 * socket-client.js - Socket.IO client wrapper
 * Manages WebSocket connection, event subscriptions, and message sending.
 */

const SocketClient = (function() {
  let socket = null;
  const listeners = new Map();
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  let pendingRoomId = null;
  let pendingPassword = null;
  let currentRoomId = null;

  function connect(playerId) {
    if (socket && socket.connected) return;

    const options = {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    };
    
    if (playerId) {
      options.query = { playerId };
    }

    socket = io(options);

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      reconnectAttempts = 0;
      _emitLocal('connect', { socketId: socket.id });

      // If we had a pending room join, retry it
      if (pendingRoomId) {
        emit('room:join', { roomId: pendingRoomId, password: pendingPassword });
      }

      // If we know we're already in a room, request full state (reconnect recovery)
      if (currentRoomId) {
        emit('game:request_state');
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      _emitLocal('disconnect', { reason });
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
      reconnectAttempts++;
      _emitLocal('connect_error', { error: err.message, attempt: reconnectAttempts });
    });

    socket.on('error', (data) => {
      if (data?.code === 'PLAYER_UNKNOWN') {
        _emitLocal('session_expired', data);
      }
      console.error('[Socket] Server error:', data);
      _emitLocal('error', data);
    });

    // Forward all game/room events to subscribers
    const serverEvents = [
      'connected',
      'room:state',
      'room:settlement',
      'room:settled',
      'player:joined',
      'player:left',
      'player:ready',
      'player:updated',
      'game:started',
      'game:dealt',
      'game:community',
      'game:turn',
      'game:action',
      'game:pot',
      'game:showdown',
      'game:ended',
      'game:state',
      'chat:message',
    ];

    serverEvents.forEach(event => {
      socket.on(event, (data) => {
        _emitLocal(event, data);
      });
    });
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }

  function isConnected() {
    return socket && socket.connected;
  }

  function emit(event, payload) {
    if (!socket || !socket.connected) {
      console.warn('[Socket] Not connected, cannot emit:', event);
      return false;
    }
    socket.emit(event, payload);
    return true;
  }

  // ============================================================
  // Convenience methods for specific events
  // ============================================================

  function joinRoom(roomId, password) {
    // Store in case we need to reconnect
    pendingRoomId = roomId;
    pendingPassword = password;
    currentRoomId = roomId;
    return emit('room:join', { roomId, password });
  }

  function leaveRoom() {
    pendingRoomId = null;
    pendingPassword = null;
    currentRoomId = null;
    return emit('room:leave');
  }

  function sit(position) {
    return emit('seat:sit', { position });
  }

  function stand() {
    return emit('seat:stand');
  }

  function ready(isReady) {
    return emit('room:ready', { ready: isReady });
  }

  function borrowChips() {
    return emit('room:borrow_chips');
  }

  function addAI() {
    return emit('room:add_ai');
  }

  function removeAI(position) {
    return emit('room:remove_ai', { position });
  }

  function startGame() {
    return emit('room:start');
  }

  function updateNickname(nickname) {
    return emit('player:update_nickname', { nickname });
  }

  function gameAction(type, amount) {
    const payload = { type };
    if (amount !== undefined && amount !== null) {
      payload.amount = amount;
    }
    return emit('game:action', payload);
  }

  function sendChat(text) {
    return emit('chat:message', { text });
  }

  function requestGameState() {
    return emit('game:request_state');
  }

  function setCurrentRoom(roomId) {
    currentRoomId = roomId;
    if (!roomId) {
      pendingRoomId = null;
      pendingPassword = null;
    }
  }

  // ============================================================
  // Event subscription (pub/sub pattern)
  // ============================================================

  function on(event, callback) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event).add(callback);
  }

  function off(event, callback) {
    if (!listeners.has(event)) return;
    if (callback) {
      listeners.get(event).delete(callback);
    } else {
      listeners.get(event).clear();
    }
  }

  function once(event, callback) {
    const wrapper = (data) => {
      off(event, wrapper);
      callback(data);
    };
    on(event, wrapper);
  }

  function _emitLocal(event, data) {
    const callbacks = listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(data);
        } catch (err) {
          console.error('[Socket] Error in listener for', event, err);
        }
      });
    }
  }

  // ============================================================
  // Public API
  // ============================================================

  return {
    get socket() { return socket; },
    connect,
    disconnect,
    isConnected,
    emit,
    joinRoom,
    leaveRoom,
    sit,
    stand,
    ready,
    borrowChips,
    addAI,
    removeAI,
    startGame,
    updateNickname,
    gameAction,
    sendChat,
    requestGameState,
    setCurrentRoom,
    on,
    off,
    once,
  };
})();
