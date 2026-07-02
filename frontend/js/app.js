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

    // Adopt the player identity that is bound to this socket.
    SocketClient.on('connected', async (data) => {
      if (data.player && data.player.id) {
        setCurrentPlayer(data.player);
        return;
      }

      if (data.playerId && state.player && state.player.id !== data.playerId) {
        console.log('[App] Server assigned new player id:', data.playerId);
        setCurrentPlayer({ ...state.player, id: data.playerId });
      }
    });

    SocketClient.on('player:updated', (data = {}) => {
      const updated = data.player;
      if (!updated || !updated.id || !state.player || updated.id !== state.player.id) return;
      setCurrentPlayer({ ...state.player, ...updated });
    });

    // Listen for session expiry and recreate guest
    SocketClient.on('session_expired', async () => {
      console.warn('[App] Player session expired, recreating guest');
      localStorage.removeItem('poker_player');
      state.player = null;
      API.setPlayerId(null);
      await ensureGuestPlayer();
    });

    // Setup hash-based routing
    window.addEventListener('hashchange', handleRoute);
    setupProfileEditor();

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
      setCurrentPlayer(result.data.player);
      console.log('[App] Guest player:', state.player.nickname);

      if (SocketClient.isConnected()) {
        SocketClient.disconnect();
      }
      SocketClient.connect(state.player.id);
    } else {
      showToast('创建访客玩家失败', 'error');
    }
  }

  function setCurrentPlayer(player) {
    if (!player || !player.id) return;

    state.player = {
      id: player.id,
      nickname: player.nickname,
      avatar: player.avatar,
      chips: player.chips,
    };
    API.setPlayerId(state.player.id);
    localStorage.setItem('poker_player', JSON.stringify(state.player));
    updateHeaderInfo();

    if (state.currentView === 'lobby') {
      LobbyView.loadRooms();
    }
  }

  function updateHeaderInfo() {
    if (!state.player) return;
    const avatar = document.getElementById('user-avatar');
    const nick = document.getElementById('user-nickname');

    if (avatar) {
      avatar.textContent = (state.player.nickname || 'G').charAt(0).toUpperCase();
      avatar.style.background = state.player.avatar || '#2ecc71';
    }
    if (nick) nick.textContent = state.player.nickname || '访客';
  }

  function setupProfileEditor() {
    const userInfo = document.getElementById('user-info');
    if (!userInfo) return;

    userInfo.style.cursor = 'pointer';
    userInfo.title = '修改玩家名称';
    userInfo.addEventListener('click', openProfileModal);

    const closeBtn = document.getElementById('modal-close-profile');
    const cancelBtn = document.getElementById('btn-cancel-profile');
    const submitBtn = document.getElementById('btn-submit-profile');
    const overlay = document.getElementById('modal-profile-overlay');
    const input = document.getElementById('input-profile-nickname');

    if (closeBtn) closeBtn.addEventListener('click', closeProfileModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeProfileModal);
    if (overlay) overlay.addEventListener('click', closeProfileModal);
    if (submitBtn) submitBtn.addEventListener('click', submitProfileNickname);
    if (input) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') submitProfileNickname();
        if (event.key === 'Escape') closeProfileModal();
      });
    }
  }

  function openProfileModal() {
    if (!state.player) return;
    const modal = document.getElementById('modal-profile');
    const input = document.getElementById('input-profile-nickname');
    if (!modal || !input) return;

    input.value = state.player.nickname || '';
    modal.style.display = 'flex';
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  function closeProfileModal() {
    const modal = document.getElementById('modal-profile');
    if (modal) modal.style.display = 'none';
  }

  function submitProfileNickname() {
    const input = document.getElementById('input-profile-nickname');
    if (!input || !state.player) return;

    const cleanNickname = input.value.trim();
    if (!cleanNickname || cleanNickname === state.player.nickname) {
      closeProfileModal();
      return;
    }

    SocketClient.updateNickname(cleanNickname);
    closeProfileModal();
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

  function showSettlementModal(data = {}, options = {}) {
    const modal = document.getElementById('modal-result');
    const title = document.getElementById('result-title');
    const body = document.getElementById('result-body');
    const footer = document.getElementById('result-footer');
    if (!modal || !title || !body || !footer) return;

    const settlements = data.settlements || (data.settlement ? [data.settlement] : []);
    title.textContent = options.title || (settlements.length > 1 ? '房间结算' : '离房结算');

    body.innerHTML = `
      <div class="settlement-list">
        ${settlements.map(renderSettlementRow).join('')}
      </div>
    `;
    footer.innerHTML = '<button class="btn btn-primary" id="btn-settlement-close">返回大厅</button>';
    modal.style.display = 'flex';

    const closeBtn = document.getElementById('btn-settlement-close');
    closeBtn.onclick = () => {
      modal.style.display = 'none';
      if (typeof options.onClose === 'function') options.onClose();
    };
  }

  function renderSettlementRow(settlement) {
    const netResult = Number(settlement.netResult) || 0;
    const netClass = netResult >= 0 ? 'settlement-positive' : 'settlement-negative';
    return `
      <div class="settlement-row">
        <div class="settlement-player">
          <span class="settlement-name">${escapeHtml(settlement.nickname || '玩家')}</span>
          <span class="settlement-result ${netClass}">${formatSignedCurrency(netResult)}</span>
        </div>
        <div class="settlement-fields">
          <span>current_chips(当前筹码): ¥${formatNumber(settlement.chips)}</span>
          <span>buy_in_total(累计买入): ¥${formatNumber(settlement.buyInTotal)}</span>
          <span>borrow_count(借码次数): ${Number(settlement.borrowCount) || 0}</span>
          <span>net_result(总输赢): ${formatSignedCurrency(netResult)}</span>
        </div>
      </div>
    `;
  }

  function formatSignedCurrency(amount) {
    const value = Number(amount) || 0;
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}¥${Math.abs(value).toLocaleString()}`;
  }

  function formatNumber(value) {
    return (Number(value) || 0).toLocaleString();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
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
    showSettlementModal,
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
