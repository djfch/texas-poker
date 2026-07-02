/**
 * table.js - 牌桌游戏界面
 * 核心扑克桌UI：环形布局、公共牌、底池、操作按钮、计时器。
 */

const TableView = (function() {
  let initialized = false;
  let gameState = null;
  let roomData = null;
  let myPosition = null;
  let timerComponent = null;
  let timerContainerEl = null;
  let seatElements = {};
  let lastHandResults = null;

  // 环形布局位置（相对于桌面的百分比）
  const SEAT_POSITIONS = [
    { left: '50%',  top: '88%',  transform: 'translate(-50%, 0)' },      // 0: 底部中央（我）
    { left: '78%',  top: '75%',  transform: 'translate(-50%, -50%)' },   // 1: 右下
    { left: '92%',  top: '50%',  transform: 'translate(-100%, -50%)' },  // 2: 右侧
    { left: '78%',  top: '20%',  transform: 'translate(-50%, -50%)' },   // 3: 右上
    { left: '62%',  top: '8%',   transform: 'translate(-50%, 0)' },      // 4: 顶部
    { left: '38%',  top: '8%',   transform: 'translate(-50%, 0)' },      // 5: 顶部
    { left: '22%',  top: '20%',  transform: 'translate(-50%, -50%)' },   // 6: 左上
    { left: '8%',   top: '50%',  transform: 'translate(0, -50%)' },      // 7: 左侧
    { left: '22%',  top: '75%',  transform: 'translate(-50%, -50%)' },   // 8: 左下
  ];

  function init() {
    if (initialized) return;
    initialized = true;

    // 离开按钮
    document.getElementById('btn-table-leave').addEventListener('click', onLeaveTable);
    document.getElementById('btn-table-borrow').addEventListener('click', onBorrowChips);
    document.getElementById('btn-table-next-action').addEventListener('click', onNextHandAction);

    // 挂载操作栏
    ActionsComponent.mount(document.getElementById('action-bar'));
    ActionsComponent.setOnAction(onPlayerAction);

    // Socket事件
    SocketClient.on('game:started', onGameStarted);
    SocketClient.on('game:dealt', onGameDealt);
    SocketClient.on('game:community', onGameCommunity);
    SocketClient.on('game:turn', onGameTurn);
    SocketClient.on('game:action', onGameAction);
    SocketClient.on('game:pot', onGamePot);
    SocketClient.on('game:showdown', onGameShowdown);
    SocketClient.on('game:ended', onGameEnded);
    SocketClient.on('room:state', onRoomState);
    SocketClient.on('room:settlement', onRoomSettlement);
    SocketClient.on('room:settled', onRoomSettled);
    SocketClient.on('game:state', onGameStateFull);
    SocketClient.on('error', onSocketError);

    // Event delegation for sit buttons
    document.getElementById('seats-ring').addEventListener('click', onSeatsRingClick);
  }

  function show(roomId) {
    document.getElementById('table-view').style.display = 'block';
    document.getElementById('app-header').style.display = 'flex';
    document.getElementById('btn-leave').style.display = 'block';
    document.getElementById('btn-leave').onclick = onLeaveTable;

    // 重置
    gameState = null;
    roomData = null;
    myPosition = null;
    seatElements = {};
    lastHandResults = null;

    // 清空桌面
    document.getElementById('seats-ring').innerHTML = '';
    document.getElementById('community-cards').innerHTML = '';
    document.getElementById('pot-display').innerHTML = '';
    document.getElementById('my-hole-cards').innerHTML = '';
    document.getElementById('action-bar').style.display = 'none';
    document.getElementById('btn-table-borrow').style.display = 'none';
    hideNextHandActionButton();
    cleanupTimer();

    // 请求完整状态
    setTimeout(() => {
      SocketClient.requestGameState();
    }, 300);
  }

  function hide() {
    document.getElementById('table-view').style.display = 'none';
    ActionsComponent.hide();
    cleanupTimer();
  }

  // ============================================================
  // Socket Handlers
  // ============================================================

  function onRoomState(data) {
    const room = data.room || data;
    roomData = room;

    if (room.name) document.getElementById('table-room-name').textContent = room.name;
    if (room.id) document.getElementById('table-room-id').textContent = '#' + room.id;
    if (room.smallBlind !== undefined) {
      document.getElementById('table-blinds').textContent = `盲注: ${room.smallBlind}/${room.bigBlind}`;
    }

    if (App.player && room.seats) {
      const mySeat = room.seats.find(s => s.playerId === App.player.id);
      if (mySeat) {
        myPosition = mySeat.position;
        document.getElementById('my-nickname').textContent = mySeat.nickname || '我';
        document.getElementById('my-chips').textContent = '¥' + (mySeat.chips || 0).toLocaleString();
        updateBorrowButton(mySeat);
        updateNextHandActionButton(mySeat);

        // If game is playing and we're seated but not at table view, redirect
        if (room.status === 'playing' && ['lobby', 'room'].includes(App.currentView)) {
          App.navigate('table', { roomId: room.id });
        }
      } else {
        updateBorrowButton(null);
        updateNextHandActionButton(null);
      }
    }

    renderSeats(room.seats || []);
    if (lastHandResults && room.awaitingNextHandReady) {
      renderHandResults(lastHandResults);
    }
  }

  function onRoomSettlement(data) {
    if (App.currentView !== 'table') return;
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
    if (App.currentView !== 'table') return;
    App.showSettlementModal(data, {
      title: '房间结算',
      onClose: () => {
        App.currentRoom = null;
        App.navigate('lobby');
      },
    });
  }

  function onGameStarted(data) {
    gameState = data.game || data;
    lastHandResults = null;
    ActionsComponent.hide();
    const modal = document.getElementById('modal-result');
    if (modal) modal.style.display = 'none';
    clearSeatHandResults();
    hideNextHandActionButton();
    document.getElementById('community-cards').innerHTML = '';
    document.getElementById('pot-display').innerHTML = '';
    document.getElementById('my-hole-cards').innerHTML = '';
    App.showToast('游戏开始！祝你好运！', 'info');
  }

  function onGameDealt(data) {
    // data: { cards, position }
    if (data.position != null && myPosition == null) {
      myPosition = data.position;
    }
    if (data.cards && (myPosition == null || data.position === myPosition)) {
      renderMyHoleCards(data.cards, { animate: true });
    }
  }

  function onGameCommunity(data) {
    // data: { cards, round }
    const container = document.getElementById('community-cards');
    container.innerHTML = '';
    data.cards.forEach((card, i) => {
      const el = CardComponent.render(card, { animate: true });
      el.style.animationDelay = `${i * 0.15}s`;
      container.appendChild(el);
    });
  }

  function onGameTurn(data) {
    // data: { position, timeoutAt, validActions?, currentBet, minRaise, totalPot }
    document.querySelectorAll('.seat-turn').forEach(el => {
      el.classList.remove('seat-turn');
    });

    const seatEl = seatElements[data.position];
    if (seatEl) {
      seatEl.classList.add('seat-turn');
    }

    cleanupTimer();

    if (data.timeoutAt) {
      const timerContainer = document.createElement('div');
      timerContainer.className = 'seat-timer-container';
      if (seatEl) {
        seatEl.appendChild(timerContainer);
      } else {
        document.getElementById('seats-ring').appendChild(timerContainer);
      }

      timerComponent = TimerComponent.create();
      timerComponent.render(timerContainer, { duration: 30000, warning: 10000 });
      timerComponent.start(data.timeoutAt);
      timerContainerEl = timerContainer;
    }

    // The server sends a private turn event with validActions to the actor,
    // followed by a public turn event without actions to the whole room.
    if (data.position === myPosition) {
      if (data.validActions) {
        const context = {
          currentBet: data.currentBet || 0,
          minRaise: data.minRaise || 0,
          totalPot: data.totalPot || 0,
          myChips: gameState?.players?.find(p => p.seatPosition === myPosition)?.chips || 0,
        };
        ActionsComponent.show(data.validActions, context);
      }
      return;
    }

    ActionsComponent.hide();
    // Show AI/human thinking indicator for current actor (not me)
    showThinkingIndicator(data.position);
  }

  function showThinkingIndicator(position) {
    const seatEl = seatElements[position];
    if (!seatEl) return;

    // Only show for AI bots (nickname starts with Bot-)
    const nicknameEl = seatEl.querySelector('.seat-nickname');
    if (!nicknameEl || !nicknameEl.textContent.startsWith('Bot-')) return;

    let thinkingEl = seatEl.querySelector('.thinking-indicator');
    if (!thinkingEl) {
      thinkingEl = document.createElement('div');
      thinkingEl.className = 'thinking-indicator';
      seatEl.appendChild(thinkingEl);
    }
    thinkingEl.textContent = '思考中...';
    thinkingEl.style.opacity = '1';

    setTimeout(() => {
      if (thinkingEl) {
        thinkingEl.style.opacity = '0';
        setTimeout(() => thinkingEl.remove(), 300);
      }
    }, 4000);
  }

  function cleanupTimer() {
    if (timerComponent) {
      timerComponent.destroy();
      timerComponent = null;
    }
    if (timerContainerEl) {
      timerContainerEl.remove();
      timerContainerEl = null;
    }
    document.querySelectorAll('.seat-timer-container').forEach(el => {
      if (!el.querySelector('.timer')) el.remove();
    });
  }

  function onGameAction(data) {
    // data: { position, type, amount }
    const seatEl = seatElements[data.position];
    if (!seatEl) return;

    if (data.type === 'fold') {
      seatEl.classList.add('seat-folded');
    } else if (data.type === 'allin') {
      seatEl.classList.add('seat-allin');
    }

    showActionText(data.position, data.type, data.amount);
  }

  function onGamePot(data) {
    // data: { mainPot, sidePots, totalPot }
    const potDisplay = document.getElementById('pot-display');
    const visibleSidePots = getVisibleSidePots(data.sidePots, data.players);
    if (potDisplay.children.length === 0) {
      PotComponent.mount(potDisplay, data.mainPot, visibleSidePots, data.totalPot);
    } else {
      PotComponent.update(data.mainPot, visibleSidePots, data.totalPot);
    }

    const betPlayers = Array.isArray(data.players)
      ? data.players.map(p => ({
        ...p,
        seatPosition: p.seatPosition ?? p.position,
      }))
      : (gameState?.players || []);

    if (gameState && Array.isArray(gameState.players) && Array.isArray(data.players)) {
      betPlayers.forEach(snapshot => {
        const player = gameState.players.find(p => p.playerId === snapshot.playerId || p.seatPosition === snapshot.seatPosition);
        if (player) {
          player.bet = snapshot.bet || 0;
          player.totalBet = snapshot.totalBet || 0;
          player.chips = snapshot.chips ?? player.chips;
        }
      });
    }

    betPlayers.forEach(p => {
      updateSeatBet(p.seatPosition, p.bet || 0);
      if (p.chips !== undefined) updateSeatChips(p.seatPosition, p.chips);
      if (p.playerId === (App.player && App.player.id) && p.chips !== undefined) {
        updateMyChips(p.chips);
      }
    });
  }

  function onGameShowdown(data) {
    // data: { results: [{ position, cards, handName }] }
    if (data.results) {
      data.results.forEach(r => {
        const statePlayer = gameState?.players?.find(p => p.seatPosition === r.position || p.playerId === r.playerId);
        if (statePlayer && r.cards) {
          statePlayer.holeCards = r.cards;
        }

        const seatEl = seatElements[r.position];
        if (seatEl) {
          if (r.cards && r.cards.length === 2) {
            const cardsContainer = getOrCreateSeatCardsContainer(seatEl);
            cardsContainer.innerHTML = '';
            r.cards.forEach(card => {
              cardsContainer.appendChild(CardComponent.render(card, { small: true }));
            });
          }
          if (r.handName) {
            const inner = seatEl.querySelector('.seat-inner');
            let handLabel = inner.querySelector('.seat-hand-name');
            if (!handLabel) {
              handLabel = document.createElement('div');
              handLabel.className = 'seat-hand-name';
              inner.appendChild(handLabel);
            }
            handLabel.textContent = r.handName;
          }
        }
      });
    }
  }

  function onGameEnded(data) {
    const modal = document.getElementById('modal-result');
    if (modal) modal.style.display = 'none';

    const handResults = data.handResults || buildHandResultsFromWinners(data.winners || []);
    lastHandResults = handResults;
    renderHandResults(handResults);

    ActionsComponent.hide();
    updateNextHandActionButton(getMySeat());
  }

  function onGameStateFull(data) {
    // 完整游戏状态（用于重连）
    gameState = data.gameState || data;
    if (gameState.players) {
      const myPlayer = gameState.players.find(p => p.playerId === (App.player && App.player.id));
      if (myPlayer) {
        myPosition = myPlayer.seatPosition;
        renderMyHoleCards(myPlayer.holeCards);
        updateMyChips(myPlayer.chips || 0);
      }
      renderSeatsFromGameState(gameState);
      gameState.players.forEach(p => {
        updateSeatBet(p.seatPosition, p.bet || 0);
        updateSeatChips(p.seatPosition, p.chips || 0);
      });
    }
    if (gameState.communityCards) {
      const container = document.getElementById('community-cards');
      container.innerHTML = '';
      gameState.communityCards.forEach(card => {
        container.appendChild(CardComponent.render(card));
      });
    }
    if (gameState.pots) {
      const potDisplay = document.getElementById('pot-display');
      PotComponent.mount(
        potDisplay,
        gameState.pots.mainPot,
        getVisibleSidePots(gameState.pots.sidePots, gameState.players),
        gameState.totalPot
      );
    }
    if (gameState.handResults) {
      lastHandResults = gameState.handResults;
      renderHandResults(lastHandResults);
    }
  }

  function renderMyHoleCards(cards, options = {}) {
    if (!cards || cards.length !== 2) return;

    const container = document.getElementById('my-hole-cards');
    container.innerHTML = '';
    cards.forEach((card, i) => {
      const el = CardComponent.render(card, { animate: options.animate === true });
      if (options.animate) {
        el.style.animationDelay = `${i * 0.2}s`;
      }
      container.appendChild(el);
    });
  }

  function onSocketError(data) {
    App.showToast(data.message || '出错了', 'error');
  }

  // ============================================================
  // 座位渲染（环形布局）
  // ============================================================

  function renderSeats(seats) {
    const ring = document.getElementById('seats-ring');
    const maxSeats = 9;

    for (let pos = 0; pos < maxSeats; pos++) {
      const seat = seats.find(s => s.position === pos) || { position: pos, status: 'empty' };
      renderOrUpdateSeat(seat);
    }
  }

  function renderSeatsFromGameState(state) {
    const ring = document.getElementById('seats-ring');
    const maxSeats = 9;

    for (let pos = 0; pos < maxSeats; pos++) {
      const player = state.players.find(p => p.seatPosition === pos);
      let seat;
      if (player) {
        seat = {
          position: pos,
          playerId: player.playerId,
          nickname: player.nickname,
          avatar: player.avatar,
          chips: player.chips,
          status: player.folded ? 'folded' : (player.allIn ? 'allin' : 'occupied'),
          holeCards: player.holeCards,
        };
      } else {
        seat = { position: pos, status: 'empty' };
      }
      renderOrUpdateSeat(seat);
    }
  }

  function renderOrUpdateSeat(seat) {
    const ring = document.getElementById('seats-ring');
    const pos = seat.position;
    const isMe = seat.playerId === (App.player && App.player.id);
    const isCurrentTurn = gameState && gameState.currentPosition === pos;
    const hasPublicCards = Boolean(gameState?.players?.some(p => !p.folded && Array.isArray(p.holeCards) && p.holeCards.length === 2));
    const showCards = gameState && (gameState.status === 'showdown' || gameState.status === 'ended' || hasPublicCards);

    const existing = seatElements[pos];
    if (existing) {
      SeatComponent.update(existing, seat, { isMe, isCurrentTurn, showCards });
    } else {
      const el = SeatComponent.render(seat, { isMe, isCurrentTurn, showCards });

      const layout = SEAT_POSITIONS[pos];
      if (layout) {
        el.style.position = 'absolute';
        el.style.left = layout.left;
        el.style.top = layout.top;
        el.style.transform = layout.transform;
      }

      ring.appendChild(el);
      seatElements[pos] = el;
    }
  }

  function onSeatsRingClick(e) {
    const sitBtn = e.target.closest('.btn-sit');
    if (sitBtn) {
      const pos = parseInt(sitBtn.dataset.position, 10);
      SocketClient.sit(pos);
    }
  }

  function updateSeatBet(position, amount) {
    const seatEl = seatElements[position];
    if (!seatEl) return;

    const inner = seatEl.querySelector('.seat-inner');
    if (!inner) return;

    let betEl = inner.querySelector('.seat-bet') || seatEl.querySelector('.seat-bet');
    if (amount > 0) {
      if (!betEl) {
        betEl = document.createElement('div');
        betEl.className = 'seat-bet';
        inner.appendChild(betEl);
      }
      betEl.innerHTML = `<span class="seat-bet-amount">¥${amount.toLocaleString()}</span>`;
    } else if (betEl) {
      betEl.remove();
    }
  }

  function updateSeatChips(position, amount) {
    const seatEl = seatElements[position];
    if (!seatEl) return;

    const chipsEl = seatEl.querySelector('.seat-chips');
    if (chipsEl) {
      chipsEl.textContent = '¥' + (Number(amount) || 0).toLocaleString();
    }
  }

  function getVisibleSidePots(sidePots, players = []) {
    if (!Array.isArray(sidePots) || sidePots.length === 0) return [];

    const snapshots = Array.isArray(players) ? players : [];
    const hasAllInPlayer =
      snapshots.some(p => p && p.allIn) ||
      (gameState?.players || []).some(p => p && p.allIn) ||
      Object.values(seatElements).some(el => el.className.split(/\s+/).includes('seat-allin'));

    return hasAllInPlayer ? sidePots : [];
  }

  function getOrCreateSeatCardsContainer(seatEl) {
    let cardsContainer = seatEl.querySelector('.seat-cards');
    if (cardsContainer) return cardsContainer;

    const inner = seatEl.querySelector('.seat-inner');
    cardsContainer = document.createElement('div');
    cardsContainer.className = 'seat-cards';
    if (inner) {
      inner.appendChild(cardsContainer);
    } else {
      seatEl.appendChild(cardsContainer);
    }
    return cardsContainer;
  }

  function clearSeatHandResults() {
    Object.values(seatElements).forEach(seatEl => {
      seatEl.classList.remove('seat-winner', 'seat-loser');
      const label = seatEl.querySelector('.seat-hand-result');
      if (label) label.remove();
    });
  }

  function renderHandResults(results) {
    clearSeatHandResults();
    (results || []).forEach(result => {
      const position = result.position ?? result.seatPosition;
      const seatEl = seatElements[position];
      if (!seatEl) return;

      const delta = Number(result.delta) || 0;
      const isWinner = result.isWinner || delta > 0;
      seatEl.classList.add(isWinner ? 'seat-winner' : 'seat-loser');
      if (result.chips !== undefined) updateSeatChips(position, result.chips);

      const inner = seatEl.querySelector('.seat-inner');
      if (!inner) return;

      let label = inner.querySelector('.seat-hand-result');
      if (!label) {
        label = document.createElement('div');
        inner.appendChild(label);
      }
      label.className = `seat-hand-result ${delta >= 0 ? 'seat-result-positive' : 'seat-result-negative'}`;
      label.textContent = formatSignedCurrency(delta);
    });
  }

  function buildHandResultsFromWinners(winners) {
    return (winners || []).map(w => ({
      playerId: w.playerId,
      position: w.position,
      nickname: w.nickname,
      delta: w.payout || w.amount || 0,
      isWinner: true,
    }));
  }

  function formatSignedCurrency(amount) {
    const value = Number(amount) || 0;
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}¥${Math.abs(value).toLocaleString()}`;
  }

  function updateMyChips(amount) {
    const myChipsEl = document.getElementById('my-chips');
    if (myChipsEl) {
      myChipsEl.textContent = '¥' + (Number(amount) || 0).toLocaleString();
    }
  }

  function showActionText(position, type, amount) {
    const seatEl = seatElements[position];
    if (!seatEl) return;

    const actionEl = document.createElement('div');
    actionEl.className = 'action-text';

    const actionNames = {
      fold: '弃牌',
      check: '过牌',
      call: '跟注',
      bet: '下注',
      raise: '加注',
      allin: '全押'
    };
    let text = actionNames[type] || type.toUpperCase();
    if (amount) text += ` ¥${amount.toLocaleString()}`;
    actionEl.textContent = text;

    seatEl.appendChild(actionEl);

    setTimeout(() => {
      actionEl.style.opacity = '0';
      actionEl.style.transform = 'translateY(-30px)';
      setTimeout(() => actionEl.remove(), 500);
    }, 1500);
  }

  // ============================================================
  // 玩家操作
  // ============================================================

  function onPlayerAction(type, amount) {
    SocketClient.gameAction(type, amount);
    ActionsComponent.hide();
  }

  function onLeaveTable() {
    SocketClient.leaveRoom();
  }

  function onBorrowChips() {
    SocketClient.borrowChips();
  }

  function onNextHandAction() {
    const mySeat = getMySeat();
    if (!mySeat) return;

    if ((Number(mySeat.chips) || 0) <= 0) {
      SocketClient.borrowChips();
      return;
    }

    if (!mySeat.isReady) {
      SocketClient.ready(true);
    }
  }

  function updateBorrowButton(mySeat) {
    const borrowBtn = document.getElementById('btn-table-borrow');
    if (!borrowBtn) return;
    borrowBtn.style.display = 'none';
    borrowBtn.disabled = true;
  }

  // ============================================================
  // 结果弹窗
  // ============================================================

  function getMySeat() {
    if (!roomData?.seats || !App.player) return null;
    return roomData.seats.find(s => s.playerId === App.player.id) || null;
  }

  function hideNextHandActionButton() {
    const btn = document.getElementById('btn-table-next-action');
    if (!btn) return;
    btn.style.display = 'none';
    btn.disabled = true;
    btn.onclick = null;
  }

  function updateNextHandActionButton(mySeat) {
    const btn = document.getElementById('btn-table-next-action');
    if (!btn) return;

    const canUse = Boolean(mySeat && roomData?.status !== 'playing' && roomData?.awaitingNextHandReady);
    if (!canUse) {
      hideNextHandActionButton();
      return;
    }

    const chips = Number(mySeat.chips) || 0;
    const isReady = Boolean(mySeat.isReady);
    btn.style.display = 'inline-flex';
    btn.disabled = chips > 0 && isReady;
    btn.textContent = chips <= 0 ? '借筹码' : (isReady ? '已准备' : '准备');
    btn.title = chips <= 0
      ? `每次借初始筹码 ¥${(roomData?.initialChips || 0).toLocaleString()}`
      : '所有玩家准备后自动开始下一局';
    btn.onclick = onNextHandAction;
  }

  return {
    init,
    show,
    hide,
  };
})();
