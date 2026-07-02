/**
 * lobby.js - Lobby view
 * Handles room listing, quick start, create room, and join room.
 */

const LobbyView = (function() {
  let initialized = false;
  let roomsData = [];

  function init() {
    if (initialized) return;
    initialized = true;

    // Event bindings
    document.getElementById('btn-quick-start').addEventListener('click', onQuickStart);
    document.getElementById('btn-create-room').addEventListener('click', openCreateModal);
    document.getElementById('btn-refresh-rooms').addEventListener('click', loadRooms);
    document.getElementById('btn-join-by-id').addEventListener('click', onJoinById);
    document.getElementById('input-room-id').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') onJoinById();
    });

    // Modal events
    document.getElementById('modal-close-create').addEventListener('click', closeCreateModal);
    document.getElementById('btn-cancel-create').addEventListener('click', closeCreateModal);
    document.getElementById('btn-submit-create').addEventListener('click', onCreateRoom);
    document.getElementById('modal-close-password').addEventListener('click', closePasswordModal);
    document.getElementById('btn-cancel-password').addEventListener('click', closePasswordModal);
    document.getElementById('btn-submit-password').addEventListener('click', onJoinWithPassword);

    // Click overlay to close
    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', (e) => {
        e.target.closest('.modal').style.display = 'none';
      });
    });

    // Auto-refresh rooms when lobby is shown
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && App.currentView === 'lobby') {
        loadRooms();
      }
    });
  }

  function show() {
    document.getElementById('lobby-view').style.display = 'block';
    document.getElementById('app-header').style.display = 'flex';
    document.getElementById('btn-leave').style.display = 'none';
    loadRooms();
    updateUserInfo();
  }

  function hide() {
    document.getElementById('lobby-view').style.display = 'none';
  }

  // ============================================================
  // Room List
  // ============================================================

  async function loadRooms() {
    const listEl = document.getElementById('room-list');
    listEl.innerHTML = '<div class="room-list-loading">加载房间中...</div>';

    const result = await API.getRooms();
    if (!result.success) {
      listEl.innerHTML = '<div class="room-list-empty">加载房间失败</div>';
      return;
    }

    roomsData = result.data.rooms || [];
    renderRoomList();
  }

  function renderRoomList() {
    const listEl = document.getElementById('room-list');

    if (roomsData.length === 0) {
      listEl.innerHTML = `
        <div class="room-list-empty">
          <p>暂无公开房间</p>
          <p class="text-muted">创建一个开始游戏吧！</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';
    roomsData.forEach(room => {
      const item = document.createElement('div');
      item.className = 'room-item';
      const isPlaying = room.status === 'playing';
      const currentPlayers = room.seatedCount || (room.players || []).length;
      const isFull = currentPlayers >= room.maxPlayers;

      item.innerHTML = `
        <div class="room-item-info">
          <span class="room-item-name">${escapeHtml(room.name)}</span>
          <span class="room-item-id">#${room.id}</span>
        </div>
        <div class="room-item-details">
          <span class="room-item-players">${currentPlayers}/${room.maxPlayers}</span>
          <span class="room-item-blinds">${room.smallBlind}/${room.bigBlind}</span>
          <span class="room-item-status ${isPlaying ? 'status-playing' : 'status-waiting'}">
            ${isPlaying ? '游戏中' : '等待中'}
          </span>
        </div>
        <button class="btn btn-primary btn-sm ${isFull || isPlaying ? 'disabled' : ''}" 
                data-room-id="${room.id}" 
                data-needs-password="${room.password ? 'true' : 'false'}"
                ${isFull || isPlaying ? 'disabled' : ''}>
          ${isFull ? '已满' : isPlaying ? '游戏中' : '加入'}
        </button>
      `;

      const joinBtn = item.querySelector('button');
      joinBtn.addEventListener('click', () => onJoinRoom(room.id, room.password));

      listEl.appendChild(item);
    });
  }

  // ============================================================
  // Actions
  // ============================================================

  async function onQuickStart() {
    App.showLoading('正在寻找游戏...');

    const result = await API.getRooms();
    const rooms = result.success ? (result.data.rooms || []) : [];

    const seatedCount = r => r.seatedCount || (r.players || []).length;
    const target = rooms.find(r =>
      r.status === 'waiting' && seatedCount(r) < r.maxPlayers && !r.password
    );

    if (target) {
      App.hideLoading();
      onJoinRoom(target.id);
    } else {
      App.hideLoading();
      // Auto-create a quick room and join
      let createResult = await API.createRoom({
        name: '快速游戏',
        maxPlayers: 6,
        smallBlind: 10,
        bigBlind: 20,
        initialChips: 1000,
        allowAI: true,
      });

      // Retry once if player session expired
      if (!createResult.success && createResult.error === 'Player not found') {
        await App.ensureGuestPlayer();
        createResult = await API.createRoom({
          name: '快速游戏',
          maxPlayers: 6,
          smallBlind: 10,
          bigBlind: 20,
          initialChips: 1000,
          allowAI: true,
        });
      }

      if (createResult.success) {
        const room = createResult.data.room;
        SocketClient.joinRoom(room.id);
        App.currentRoom = room.id;
        App.navigate('room', { roomId: room.id });
        App.showToast('已创建快速游戏房间', 'success');
      } else {
        App.showToast(createResult.error || '创建房间失败', 'error');
      }
    }
  }

  function onJoinRoom(roomId, hasPassword) {
    if (hasPassword) {
      document.getElementById('modal-password').style.display = 'flex';
      document.getElementById('modal-password').dataset.roomId = roomId;
      document.getElementById('input-room-password').value = '';
      document.getElementById('input-room-password').focus();
    } else {
      doJoinRoom(roomId);
    }
  }

  async function onJoinWithPassword() {
    const modal = document.getElementById('modal-password');
    const roomId = modal.dataset.roomId;
    const password = document.getElementById('input-room-password').value;
    closePasswordModal();
    doJoinRoom(roomId, password);
  }

  async function onJoinById() {
    const input = document.getElementById('input-room-id');
    const roomId = input.value.trim().toUpperCase();
    if (!roomId) {
      App.showToast('请输入房间号', 'error');
      return;
    }
    if (!/^[A-Z0-9]{6}$/.test(roomId)) {
      App.showToast('房间号必须为6位字母或数字', 'error');
      return;
    }
    doJoinRoom(roomId);
  }

  async function doJoinRoom(roomId, password) {
    App.showLoading('正在加入房间...');

    const result = await API.joinRoom(roomId, password);
    App.hideLoading();

    if (!result.success) {
      App.showToast(result.error || '加入房间失败', 'error');
      return;
    }

    SocketClient.joinRoom(roomId, password);
    App.currentRoom = roomId;
    App.navigate('room', { roomId });
  }

  // ============================================================
  // Create Room Modal
  // ============================================================

  function openCreateModal() {
    document.getElementById('modal-create-room').style.display = 'flex';
    document.getElementById('create-room-name').focus();
  }

  function closeCreateModal() {
    document.getElementById('modal-create-room').style.display = 'none';
  }

  function closePasswordModal() {
    document.getElementById('modal-password').style.display = 'none';
  }

  async function onCreateRoom() {
    const name = document.getElementById('create-room-name').value.trim() || 'Texas Room';
    const maxPlayers = parseInt(document.getElementById('create-room-max-players').value, 10);
    const smallBlind = parseInt(document.getElementById('create-room-sb').value, 10);
    const bigBlind = parseInt(document.getElementById('create-room-bb').value, 10);
    const initialChips = parseInt(document.getElementById('create-room-chips').value, 10);
    const allowAI = document.getElementById('create-room-ai').checked;
    const password = document.getElementById('create-room-password').value.trim() || null;

    if (!Number.isFinite(smallBlind) || !Number.isFinite(bigBlind) || bigBlind < smallBlind * 2) {
      App.showToast('大盲注应至少为小盲注的2倍', 'warning');
      return;
    }

    closeCreateModal();
    App.showLoading('创建房间中...');

    let result = await API.createRoom({
      name,
      maxPlayers,
      smallBlind,
      bigBlind,
      initialChips,
      allowAI,
      password,
    });

    // If player session expired, recreate guest and retry once
    if (!result.success && result.error === 'Player not found') {
      await App.ensureGuestPlayer();
      result = await API.createRoom({
        name,
        maxPlayers,
        smallBlind,
        bigBlind,
        initialChips,
        allowAI,
        password,
      });
    }

    App.hideLoading();

    if (!result.success) {
      App.showToast(result.error || '创建房间失败', 'error');
      return;
    }

    const room = result.data.room;
    App.currentRoom = room.id;
    SocketClient.joinRoom(room.id, password);
    App.navigate('room', { roomId: room.id });
    App.showToast(`房间 #${room.id} 创建成功！`, 'success');
  }

  // ============================================================
  // Helpers
  // ============================================================

  function updateUserInfo() {
    if (App.player) {
      const avatar = document.getElementById('user-avatar');
      const nick = document.getElementById('user-nickname');

      if (avatar) avatar.textContent = (App.player.nickname || 'G').charAt(0).toUpperCase();
      if (nick) nick.textContent = App.player.nickname || '访客';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    init,
    show,
    hide,
    loadRooms,
  };
})();
