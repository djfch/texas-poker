/**
 * backend/socket/events.js - Socket Event Definitions
 * 
 * Centralized event names for Socket.IO communication.
 */

module.exports = {
  // Client -> Server
  CLIENT: {
    JOIN_ROOM: 'room:join',
    LEAVE_ROOM: 'room:leave',
    SIT: 'seat:sit',
    STAND: 'seat:stand',
    READY: 'room:ready',
    START_GAME: 'room:start',
    GAME_ACTION: 'game:action',
    CHAT_MESSAGE: 'chat:message',
    REQUEST_STATE: 'game:request_state',
  },

  // Server -> Client
  SERVER: {
    ROOM_STATE: 'room:state',
    PLAYER_JOINED: 'player:joined',
    PLAYER_LEFT: 'player:left',
    PLAYER_READY: 'player:ready',
    PLAYER_SAT: 'player:sat',
    PLAYER_STOOD: 'player:stood',
    GAME_STARTED: 'game:started',
    GAME_DEALT: 'game:dealt',
    GAME_COMMUNITY: 'game:community',
    GAME_TURN: 'game:turn',
    GAME_ACTION: 'game:action',
    GAME_POT: 'game:pot',
    GAME_SHOWDOWN: 'game:showdown',
    GAME_ENDED: 'game:ended',
    GAME_STATE: 'game:state',
    CHAT_MESSAGE: 'chat:message',
    ERROR: 'error',
  },
};
