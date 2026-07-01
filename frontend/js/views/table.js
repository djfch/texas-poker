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
  let seatElements = {};

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

    // 清空桌面
    document.getElementById('seats-ring').innerHTML = '';
    document.getElementById('community-cards').innerHTML = '';
    document.getElementById('pot-display').innerHTML = '';
    document.getElementById('my-hole-cards').innerHTML = '';
    document.getElementById('action-bar').style.display = 'none';

    // 请求完整状态
    setTimeout(() => {
      SocketClient.requestGameState();
    }, 300);
  }

  function hide() {
    document.getElementById('table-view').style.display = 'none';
    ActionsComponent.hide();
    if (timerComponent) {
      timerComponent.destroy();
      timerComponent = null;
    }
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

        // If game is playing and we're seated but not at table view, redirect
        if (room.status === 'playing' && ['lobby', 'room'].includes(App.currentView)) {
          App.navigate('table', { roomId: room.id });
        }
      }
    }

    renderSeats(room.seats || []);
  }

  function onGameStarted(data) {
    gameState = data.game || data;
    ActionsComponent.hide();
    document.getElementById('community-cards').innerHTML = '';
    document.getElementById('pot-display').innerHTML = '';
    document.getElementById('my-hole-cards').innerHTML = '';
    App.showToast('游戏开始！祝你好运！', 'info');
  }

  function onGameDealt(data) {
    // data: { cards, position }
    if (data.position === myPosition && data.cards) {
      const container = document.getElementById('my-hole-cards');
      container.innerHTML = '';
      data.cards.forEach((card, i) => {
        const el = CardComponent.render(card, { animate: true });
        el.style.animationDelay = `${i * 0.2}s`;
        container.appendChild(el);
      });
    }
  }

  function onGameCommunity(data) {
    // data: { cards, round }
    const container = document.getElementById('community-cards');
    if (data.round === 'flop') {
      container.innerHTML = '';
      data.cards.forEach((card, i) => {
        const el = CardComponent.render(card, { animate: true });
        el.style.animationDelay = `${i * 0.15}s`;
        container.appendChild(el);
      });
    } else {
      data.cards.forEach(card => {
        container.appendChild(CardComponent.render(card, { animate: true }));
      });
    }
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

    if (timerComponent) {
      timerComponent.destroy();
      timerComponent = null;
    }

    if (data.timeoutAt) {
      const timerContainer = document.createElement('div');
      timerContainer.className = 'seat-timer-container';
      timerContainer.style.position = 'absolute';

      const pos = SEAT_POSITIONS[data.position] || SEAT_POSITIONS[0];
      timerContainer.style.left = pos.left;
      timerContainer.style.top = pos.top;
      timerContainer.style.transform = pos.transform;

      document.getElementById('seats-ring').appendChild(timerContainer);

      timerComponent = TimerComponent.create();
      timerComponent.render(timerContainer, { duration: 30000, warning: 10000 });
      timerComponent.start(data.timeoutAt);
    }

    // If it's my turn, show valid actions
    if (data.position === myPosition && data.validActions) {
      const context = {
        currentBet: data.currentBet || 0,
        minRaise: data.minRaise || 0,
        totalPot: data.totalPot || 0,
        myChips: gameState?.players?.find(p => p.seatPosition === myPosition)?.chips || 0,
      };
      ActionsComponent.show(data.validActions, context);
    } else {
      ActionsComponent.hide();
      // Show AI/human thinking indicator for current actor (not me)
      showThinkingIndicator(data.position);
    }
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
    if (potDisplay.children.length === 0) {
      PotComponent.mount(potDisplay, data.mainPot, data.sidePots);
    } else {
      PotComponent.update(data.mainPot, data.sidePots);
    }

    // Update seat bet displays from gameState if available
    if (gameState && gameState.players) {
      gameState.players.forEach(p => {
        updateSeatBet(p.seatPosition, p.bet || 0);
      });
    }
  }

  function onGameShowdown(data) {
    // data: { results: [{ position, cards, handName }] }
    if (data.results) {
      data.results.forEach(r => {
        const seatEl = seatElements[r.position];
        if (seatEl) {
          if (r.cards && r.cards.length === 2) {
            const cardsContainer = seatEl.querySelector('.seat-cards');
            if (cardsContainer) {
              cardsContainer.innerHTML = '';
              r.cards.forEach(card => {
                cardsContainer.appendChild(CardComponent.render(card, { small: true }));
              });
            }
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
    // data: { winners: [{ position, payout }], nextHandDelay }
    if (data.winners) {
      data.winners.forEach(w => {
        const seatEl = seatElements[w.position];
        if (seatEl) {
          seatEl.classList.add('seat-winner');
          const inner = seatEl.querySelector('.seat-inner');
          let winnerLabel = inner.querySelector('.seat-winner-amount');
          if (!winnerLabel) {
            winnerLabel = document.createElement('div');
            winnerLabel.className = 'seat-winner-amount';
            inner.appendChild(winnerLabel);
          }
          winnerLabel.textContent = '+¥' + (w.payout || w.amount || 0).toLocaleString();
        }
      });
    }

    ActionsComponent.hide();

    if (App.currentView === 'table') {
      setTimeout(() => {
        showResultModal(data);
      }, 1500);
    }
  }

  function onGameStateFull(data) {
    // 完整游戏状态（用于重连）
    gameState = data.gameState || data;
    if (gameState.players) renderSeatsFromGameState(gameState);
    if (gameState.communityCards) {
      const container = document.getElementById('community-cards');
      container.innerHTML = '';
      gameState.communityCards.forEach(card => {
        container.appendChild(CardComponent.render(card));
      });
    }
    if (gameState.pots) {
      const potDisplay = document.getElementById('pot-display');
      PotComponent.mount(potDisplay, gameState.pots.mainPot, gameState.pots.sidePots);
    }
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
    const showCards = gameState && (gameState.status === 'showdown' || gameState.status === 'ended');

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

    let betEl = seatEl.querySelector('.seat-bet');
    if (amount > 0) {
      if (!betEl) {
        betEl = document.createElement('div');
        betEl.className = 'seat-bet';
        seatEl.querySelector('.seat-inner').appendChild(betEl);
      }
      betEl.innerHTML = `<span class="seat-bet-amount">¥${amount.toLocaleString()}</span>`;
    } else if (betEl) {
      betEl.remove();
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
    App.currentRoom = null;
    App.navigate('lobby');
  }

  // ============================================================
  // 结果弹窗
  // ============================================================

  function showResultModal(data) {
    const modal = document.getElementById('modal-result');
    if (!modal) return;

    const body = document.getElementById('result-body');
    const title = document.getElementById('result-title');

    const isWinner = data.winners && data.winners.some(w => w.position === myPosition);
    title.textContent = isWinner ? '你赢了！' : '本局结束';

    let html = '';
    if (data.winners) {
      html += '<div class="result-winners">';
      data.winners.forEach(w => {
        const seat = gameState?.players?.find(p => p.seatPosition === w.position);
        const name = seat ? seat.nickname : `玩家 ${w.position + 1}`;
        html += `<div class="result-winner">
          <span class="result-winner-name">${escapeHtml(name)}</span>
          <span class="result-winner-amount">+¥${(w.payout || w.amount || 0).toLocaleString()}</span>
        </div>`;
      });
      html += '</div>';
    }

    body.innerHTML = html;
    modal.style.display = 'flex';

    const nextBtn = document.getElementById('btn-next-hand');
    if (nextBtn) {
      nextBtn.onclick = () => {
        modal.style.display = 'none';
        SocketClient.startGame();
      };
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
  };
})();
