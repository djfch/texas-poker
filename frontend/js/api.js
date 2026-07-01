/**
 * API.js - HTTP API wrapper for Texas Hold'em Poker
 * Wraps all REST API calls with fetch, handles JSON and errors uniformly.
 */

const API = (function() {
  const BASE_URL = ''; // Same origin
  let playerId = null;

  /**
   * Set the current player's ID (used for authenticated requests)
   */
  function setPlayerId(id) {
    playerId = id;
  }

  /**
   * Generic request wrapper
   */
  async function request(method, path, body) {
    const url = `${BASE_URL}${path}`;
    const options = {
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
      },
    };

    // Add player ID header if available
    if (playerId) {
      options.headers['x-player-id'] = playerId;
    }

    if (body && method.toUpperCase() !== 'GET') {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          success: false,
          error: data.error || data.message || `HTTP ${response.status}`,
          status: response.status,
        };
      }

      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Network error',
      };
    }
  }

  // ============================================================
  // Auth
  // ============================================================

  async function createGuest() {
    return request('POST', '/api/auth/guest');
  }

  async function register(username, password) {
    return request('POST', '/api/auth/register', { username, password });
  }

  async function login(username, password) {
    return request('POST', '/api/auth/login', { username, password });
  }

  // ============================================================
  // Rooms
  // ============================================================

  async function getRooms() {
    return request('GET', '/api/rooms');
  }

  async function createRoom(config) {
    return request('POST', '/api/rooms', config);
  }

  async function getRoom(roomId) {
    return request('GET', `/api/rooms/${roomId}`);
  }

  async function joinRoom(roomId, password) {
    return request('POST', `/api/rooms/${roomId}/join`, { password });
  }

  // ============================================================
  // User
  // ============================================================

  async function getProfile() {
    return request('GET', '/api/user/profile');
  }

  async function getHistory() {
    return request('GET', '/api/user/history');
  }

  // ============================================================
  // Public API
  // ============================================================

  return {
    setPlayerId,
    request,
    createGuest,
    register,
    login,
    getRooms,
    createRoom,
    getRoom,
    joinRoom,
    getProfile,
    getHistory,
  };
})();
