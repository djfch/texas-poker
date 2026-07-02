/**
 * room.js - 房间等待界面
 * 显示座位、准备状态，处理游戏开始。
 */

const RoomView = (function() {
  let initialized = false;
  let roomData = null;
  let mySeatPosition = null;
  let isHost = false;
  let isReady = false;

  function init() {
    if (initialized) return;
    initialized = true;

    // Event bindings
    document.getElementById('btn-room-ready').addEventListener('click', onToggleReady);
    document.getElementById('btn-room-add-ai').addEventListener('click', onAddAI);
    document.getElementById('btn-room-borrow').addEventListener('click', onBorrowChips);
    document.getElementById('btn-room-start').addEventListener('click', onStartGame);
    document.getElementById('btn-room-leave').addEventListener('click', onLeaveRoom);

    // Socket event listeners
    SocketClient.on('room:state', onRoomState);
    SocketClient.on('player:joined', onPlayerJoined);
    SocketClient.on('player:left', onPlayerLeft);
    SocketClient.on('player:ready', onPlayerReady);
    SocketClient.on('room:settlement', onRoomSettlement);
    SocketClient.on('room:settled', onRoomSettled);
    SocketClient.on('game:started', onGameStarted);
    SocketClient.on('error', onSocketError);

    // Use event delegation for dynamic seat buttons
    document.getElementById('seats-grid').addEventListener('click', onSeatsGridClick);
  }

  function show(roomId) {
    document.getElementById('room-view').style.display = 'block';
    document.getElementById('app-header').style.display = 'flex';
    document.getElementById('btn-leave').style.display = 'block';
    document.getElementById('btn-leave').onclick = onLeaveRoom;

    // Reset state
    roomData = null;
    mySeatPosition = null;
    isHost = false;
    isReady = false;

    // Request room state (wait for socket if not connected)
    if (roomId) {
      if (SocketClient.isConnected()) {
        SocketClient.joinRoom(roomId);
      } else {
        const onConnect = () => {
          SocketClient.joinRoom(roomId);
          SocketClient.off('connect', onConnect);
        };
        SocketClient.on('connect', onConnect);
      }
    }
  }

  function hide() {
    document.getElementById('room-view').style.display = 'none';
  }

  // ============================================================
  // Socket Handlers
  // ============================================================

  function onRoomState(data) {
    roomData = data.room || data;
    updateUI();
  }

  function onPlayerJoined(data) {
    if (!roomData) return;
    const seat = data.seat;
    if (!seat) return;

    const existing = roomData.players.find(p => p.playerId === seat.playerId);
    if (!existing) {
      roomData.players.push({
        playerId: seat.playerId,
        nickname: seat.nickname,
        avatar: seat.avatar,
        seatPosition: seat.position,
        isReady: seat.isReady,
      });
    }

    const seatEl = roomData.seats.find(s => s.position === seat.position);
    if (seatEl) {
      seatEl.playerId = seat.playerId;
      seatEl.nickname = seat.nickname;
      seatEl.avatar = seat.avatar;
      seatEl.isReady = seat.isReady;
      seatEl.status = 'occupied';
    }
    updateUI();
  }

  function onPlayerLeft(data) {
    if (!roomData) return;
    const position = data.position;

    const seat = roomData.seats.find(s => s.position === position);
    if (seat) {
      roomData.players = roomData.players.filter(p => p.playerId !== seat.playerId);
      seat.playerId = null;
      seat.nickname = null;
      seat.avatar = null;
      seat.isReady = false;
      seat.status = 'empty';
    }
    updateUI();
  }

  function onPlayerReady(data) {
    if (!roomData) return;
    const position = data.position;
    const ready = data.ready;

    const seat = roomData.seats.find(s => s.position === position);
    if (seat) {
      seat.isReady = ready;
      const player = roomData.players.find(p => p.playerId === seat.playerId);
      if (player) player.isReady = ready;
    }
    updateUI();
  }

  function onGameStarted(data) {
    App.navigate('table', { roomId: App.currentRoom });
  }

  function onRoomSettlement(data) {
    if (App.currentView !== 'room') return;
    if (data.type === 'borrow') {
      App.showToast(`已借筹码 ¥${(roomData?.initialChips || 0).toLocaleString()}`, 'success');
      return;
    }

    App.showSettlementModal(data, {
      title: '离房结算',
      onClose: () => {
        App.currentRoom = null;
        App.navigate('lobby');
      },
    });
  }

  function onRoomSettled(data) {
    if (App.currentView !== 'room') return;
    App.showSettlementModal(data, {
      title: '房间结算',
      onClose: () => {
        App.currentRoom = null;
        App.navigate('lobby');
      },
    });
  }

  function onSocketError(data) {
    console.error('[Room] Socket error:', data);
    if (data.error === 'Room not found' || data.error === '房间不存在') {
      App.showToast('房间已关闭或不存在', 'warning');
      App.currentRoom = null;
      setTimeout(() => App.navigate('lobby'), 1000);
      return;
    }
    App.showToast(data.message || data.error || '出错了', 'error');
  }

  // ============================================================
  // UI Update
  // ============================================================

  function updateUI() {
    if (!roomData) return;

    // Header info
    document.getElementById('room-name').textContent = roomData.name || '房间';
    document.getElementById('room-id-display').textContent = `房间号: ${roomData.id}`;
    document.getElementById('room-blinds').textContent = `盲注: ${roomData.smallBlind}/${roomData.bigBlind}`;

    const seatedCount = (roomData.seats || []).filter(s => s && s.playerId).length;
    document.getElementById('room-players').textContent = `${seatedCount}/${roomData.maxPlayers} 人`;

    // Determine if I can control start and my seat
    const mySeat = (roomData.seats || []).find(s => s && s.playerId === (App.player && App.player.id));
    const hostPlayer = (roomData.players || []).find(p => p.playerId === roomData.hostId);
    isHost = roomData.hostId === (App.player && App.player.id) || Boolean(mySeat && hostPlayer && hostPlayer.isAI);
    mySeatPosition = mySeat ? mySeat.position : null;
    isReady = mySeat ? mySeat.isReady : false;

    // Render seats
    renderSeats();

    // Update action buttons
    const readyBtn = document.getElementById('btn-room-ready');
    const addAIBtn = document.getElementById('btn-room-add-ai');
    const borrowBtn = document.getElementById('btn-room-borrow');
    const startBtn = document.getElementById('btn-room-start');
    const myChips = mySeat ? Number(mySeat.chips) || 0 : 0;
    const canBorrow = Boolean(mySeat && roomData.status !== 'playing' && myChips <= 0);

    if (mySeatPosition !== null) {
      readyBtn.style.display = 'inline-flex';
      readyBtn.textContent = isReady ? '取消准备' : '准备';
      readyBtn.className = isReady ? 'btn btn-warning' : 'btn btn-primary';
      readyBtn.disabled = canBorrow;
      readyBtn.title = canBorrow ? '筹码为 0，请先借筹码' : '';
    } else {
      readyBtn.style.display = 'none';
      readyBtn.disabled = false;
      readyBtn.title = '';
    }

    borrowBtn.style.display = canBorrow ? 'inline-flex' : 'none';
    borrowBtn.disabled = !canBorrow;
    borrowBtn.title = `每次借初始筹码 ¥${(roomData.initialChips || 0).toLocaleString()}`;

    const canShowAddAI = isHost && roomData.allowAI;
    const canAddAI = canShowAddAI && roomData.status !== 'playing' && seatedCount < roomData.maxPlayers;
    addAIBtn.style.display = canShowAddAI ? 'inline-flex' : 'none';
    addAIBtn.disabled = !canAddAI;
    if (!canAddAI) {
      addAIBtn.title = seatedCount >= roomData.maxPlayers ? '房间已满' : '当前不能添加AI';
    } else {
      addAIBtn.title = '添加一个AI玩家';
    }

    if (isHost) {
      const seatedSeats = (roomData.seats || []).filter(s => s.playerId);
      const allReady = seatedSeats.every(s => s.isReady);
      const allFunded = seatedSeats.every(s => (Number(s.chips) || 0) > 0);
      const canFillWithAI = roomData.allowAI && seatedCount >= 1;
      const enoughPlayers = seatedCount >= 2 || canFillWithAI;
      startBtn.style.display = 'inline-flex';
      startBtn.disabled = !(allReady && enoughPlayers && allFunded);
      if (startBtn.disabled) {
        startBtn.title = !allFunded ? '有玩家筹码为 0，需要先借筹码' : (allReady ? '至少需要2名玩家' : '还有玩家未准备');
      } else {
        startBtn.title = canFillWithAI && seatedCount < 2 ? '开始后将由 AI 补位' : '';
      }
    } else {
      startBtn.style.display = 'none';
    }
  }

  function renderSeats() {
    const grid = document.getElementById('seats-grid');
    grid.innerHTML = '';

    const maxPlayers = roomData.maxPlayers || 9;
    const seats = roomData.seats || [];
    const myPlayerId = App.player && App.player.id;

    for (let pos = 0; pos < maxPlayers; pos++) {
      const seat = seats.find(s => s && s.position === pos) || { position: pos, status: 'empty' };
      const isMe = seat.playerId === myPlayerId;

      const el = document.createElement('div');
      el.className = 'room-seat';
      el.dataset.position = pos;
      if (isMe) el.classList.add('room-seat-me');
      if (seat.status === 'empty') el.classList.add('room-seat-empty');
      if (seat.isReady) el.classList.add('room-seat-ready');

      if (seat.status === 'empty') {
        el.innerHTML = `
          <div class="room-seat-empty-inner">
            <span class="room-seat-number">座位 ${pos + 1}</span>
            <button class="btn btn-ghost btn-sm btn-sit" data-position="${pos}">入座</button>
          </div>
        `;
      } else {
        const avatarChar = seat.isAI ? '🤖' : (seat.nickname ? seat.nickname.charAt(0).toUpperCase() : '?');
        const avatarColor = seat.avatar || '#3498db';
        const readyBadge = seat.isReady ? '<span class="ready-badge">已准备</span>' : '';
        const chipsText = Number(seat.chips || 0).toLocaleString();
        const removeAIButton = (isHost && seat.isAI && roomData.status !== 'playing')
          ? `<button class="btn btn-ghost btn-sm btn-remove-ai" data-position="${pos}">移除AI</button>`
          : '';

        el.innerHTML = `
          <div class="room-seat-inner">
            <div class="room-seat-avatar" style="background:${avatarColor}">${avatarChar}</div>
            <div class="room-seat-info">
              <span class="room-seat-name">${escapeHtml(seat.nickname || '玩家')}</span>
              ${seat.isAI ? '<span class="room-seat-ai">AI</span>' : ''}
            </div>
            <span class="room-seat-chips">¥${chipsText}</span>
            ${readyBadge}
            ${isMe ? '<button class="btn btn-ghost btn-sm btn-stand">起身</button>' : ''}
            ${removeAIButton}
          </div>
        `;
      }

      grid.appendChild(el);
    }
  }

  function onSeatsGridClick(e) {
    const removeAIBtn = e.target.closest('.btn-remove-ai');
    if (removeAIBtn) {
      const pos = parseInt(removeAIBtn.dataset.position, 10);
      removeAIBtn.disabled = true;
      removeAIBtn.textContent = '...';
      SocketClient.removeAI(pos);
      setTimeout(() => {
        removeAIBtn.disabled = false;
        removeAIBtn.textContent = '移除AI';
      }, 1500);
      return;
    }

    const sitBtn = e.target.closest('.btn-sit');
    if (sitBtn) {
      const pos = parseInt(sitBtn.dataset.position, 10);
      sitBtn.disabled = true;
      sitBtn.textContent = '...';
      SocketClient.sit(pos);
      setTimeout(() => {
        sitBtn.disabled = false;
        sitBtn.textContent = '入座';
      }, 1500);
      return;
    }

    const standBtn = e.target.closest('.btn-stand');
    if (standBtn) {
      SocketClient.stand();
    }
  }

  // ============================================================
  // Actions
  // ============================================================

  function onToggleReady() {
    SocketClient.ready(!isReady);
  }

  function onStartGame() {
    SocketClient.startGame();
  }

  function onAddAI() {
    SocketClient.addAI();
  }

  function onBorrowChips() {
    SocketClient.borrowChips();
  }

  function onLeaveRoom() {
    SocketClient.leaveRoom();
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
  };
})();
