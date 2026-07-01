/**
 * app.js - SPA entry point
 * Initializes the app, handles routing, view switching, and global state.
 */

const App = (function() {
  // ============================================================
  // Global State
  // ============================================================
  const state = {
    player: null,
    currentRoom: null,
    currentView: null,
  };

  // ============================================================
  // Initialization
  // ============================================================

  async function init() {
    console.log('[App] Initializing...');

    // Try to restore player from localStorage before connecting
    const saved = localStorage.getItem('poker_player');
    let restoredPlayerId = null;
    if (saved) {
      try {
        const player = JSON.parse(saved);
        state.player = player;
        API.setPlayerId(player.id);
        restoredPlayerId = player.id;
        console.log('[App] Restored player from localStorage:', player.nickname);
        updateHeaderInfo();
      } catch (e) {
        localStorage.removeItem('poker_player');
      }
    }

    // Connect Socket.IO with playerId if available
    SocketClient.connect(restoredPlayerId);

    // Wait for socket connection, then create guest if no restored player
    SocketClient.once('connect', async () => {
      if (!state.player) {
        await ensureGuestPlayer();
      }
    });

    // Listen for backend telling us our player id is unknown (server restart)
    SocketClient.on('connected', async (data) => {
      if (data.playerId && state.player && state.player.id !== data.playerId) {
        // Server assigned a new player id; adopt it
        console.log('[App] Server assigned new player id:', data.playerId);
        const newPlayer = { ...state.player, id: data.playerId };
        state.player = newPlayer;
        API.setPlayerId(data.playerId);
        localStorage.setItem('poker_player', JSON.stringify(newPlayer));
        updateHeaderInfo();
      }
    });

    // Listen for session expiry and recreate guest
    SocketClient.on('session_expired', async () => {
      console.warn('[App] Player session expired, recreating guest');
      localStorage.removeItem('poker_player');
      state.player = null;
      API.setPlayerId(null);
      await ensureGuestPlayer();
    });

    // If already connected
    if (SocketClient.isConnected() && !state.player) {
      await ensureGuestPlayer();
    }

    // Setup hash-based routing
    window.addEventListener('hashchange', handleRoute);

    // Initialize all views
    LobbyView.init();
    RoomView.init();
    TableView.init();

    // Handle initial route
    handleRoute();

    console.log('[App] Initialized');
  }

  async function ensureGuestPlayer() {
    // If current player is invalid, clear it so we create a fresh one
    if (state.player) {
      const result = await API.getProfile?.();
      if (!result || !result.success) {
        state.player = null;
        API.setPlayerId(null);
        localStorage.removeItem('poker_player');
      } else {
        return;
      }
    }

    const result = await API.createGuest();
    if (result.success) {
      state.player = result.data.player;
      API.setPlayerId(state.player.id);
      localStorage.setItem('poker_player', JSON.stringify(state.player));
      console.log('[App] Guest player:', state.player.nickname);
      updateHeaderInfo();
      if (state.currentView === 'lobby') {
        LobbyView.loadRooms();
      }
    } else {
      showToast('创建访客玩家失败', 'error');
    }
  }

  function updateHeaderInfo() {
    if (!state.player) return;
    const avatar = document.getElementById('user-avatar');
    const nick = document.getElementById('user-nickname');
    const chips = document.getElementById('user-chips');

    if (avatar) {
      avatar.textContent = (state.player.nickname || 'G').charAt(0).toUpperCase();
      avatar.style.background = state.player.avatar || '#2ecc71';
    }
    if (nick) nick.textContent = state.player.nickname || '访客';
    if (chips) chips.textContent = '筹码: ¥' + (state.player.chips || 0).toLocaleString();
  }

  // ============================================================
  // Routing
  // ============================================================

  function handleRoute() {
    const hash = window.location.hash || '#/';
    console.log('[App] Route:', hash);

    // Parse hash: #/room/ABC123 or #/table/ABC123
    let view = 'lobby';
    let params = {};

    if (hash.startsWith('#/room/')) {
      view = 'room';
      params.roomId = hash.replace('#/room/', '').split('/')[0];
    } else if (hash.startsWith('#/table/')) {
      view = 'table';
      params.roomId = hash.replace('#/table/', '').split('/')[0];
    } else if (hash === '#/') {
      view = 'lobby';
    }

    switchView(view, params);
  }

  function navigate(view, params = {}) {
    let hash = '#/';
    if (view === 'room' && params.roomId) {
      hash = `#/room/${params.roomId}`;
      SocketClient.setCurrentRoom(params.roomId);
    } else if (view === 'table' && params.roomId) {
      hash = `#/table/${params.roomId}`;
      SocketClient.setCurrentRoom(params.roomId);
    } else if (view === 'lobby') {
      SocketClient.setCurrentRoom(null);
    }

    if (window.location.hash !== hash) {
      window.location.hash = hash;
    } else {
      switchView(view, params);
    }
  }

  function switchView(view, params = {}) {
    // Hide all views
    LobbyView.hide();
    RoomView.hide();
    TableView.hide();

    state.currentView = view;

    switch (view) {
      case 'lobby':
        LobbyView.show();
        break;
      case 'room':
        RoomView.show(params.roomId);
        break;
      case 'table':
        TableView.show(params.roomId);
        break;
      default:
        LobbyView.show();
    }
  }

  // ============================================================
  // Toast / Notifications
  // ============================================================

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    // Auto remove after animation
    setTimeout(() => {
      toast.remove();
    }, 3500);
  }

  // ============================================================
  // Loading Overlay
  // ============================================================

  function showLoading(message = '加载中...') {
    // Check if overlay exists
    let overlay = document.getElementById('app-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'app-loading-overlay';
      overlay.className = 'app-loading-overlay';
      overlay.innerHTML = `
        <div class="app-loading-content">
          <div class="spinner"></div>
          <span class="app-loading-text">加载中...</span>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.app-loading-text').textContent = message;
    overlay.style.display = 'flex';
  }

  function hideLoading() {
    const overlay = document.getElementById('app-loading-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // ============================================================
  // Public API
  // ============================================================

  return {
    init,
    navigate,
    showToast,
    showLoading,
    hideLoading,
    ensureGuestPlayer,
    get player() { return state.player; },
    set player(val) { state.player = val; updateHeaderInfo(); },
    get currentRoom() { return state.currentRoom; },
    set currentRoom(val) { state.currentRoom = val; },
    get currentView() { return state.currentView; },
  };
})();

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
