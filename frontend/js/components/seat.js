/**
 * seat.js - Seat component for poker table
 * Renders individual seats with player info, status indicators, and cards.
 */

const SeatComponent = (function() {
  const STATUS_LABELS = {
    empty: '空位',
    occupied: '',
    ready: '已准备',
    playing: '',
    folded: '已弃牌',
    allin: '全押',
    left: '已离开',
  };

  /**
   * Render a single seat
   * @param {Object} seat - Seat data from server
   * @param {Object} options - { isMe?, isCurrentTurn?, showCards?, myPosition? }
   * @returns {HTMLElement}
   */
  function render(seat, options = {}) {
    const el = document.createElement('div');
    el.className = 'seat';
    el.dataset.position = seat.position;

    const isEmpty = !seat.playerId && seat.status === 'empty';
    const isMe = options.isMe === true;
    const isCurrentTurn = options.isCurrentTurn === true;
    const showCards = options.showCards === true;

    // Base status class
    if (isEmpty) {
      el.classList.add('seat-empty');
    } else {
      el.classList.add(`seat-${seat.status || 'occupied'}`);
    }

    if (isMe) el.classList.add('seat-me');
    if (isCurrentTurn) el.classList.add('seat-turn');
    if (seat.isDealer) el.classList.add('seat-dealer');
    if (seat.isSmallBlind) el.classList.add('seat-sb');
    if (seat.isBigBlind) el.classList.add('seat-bb');
    if (seat.isAI) el.classList.add('seat-ai');

    // Inner HTML
    let html = '';

    if (isEmpty) {
      html = `
        <div class="seat-inner">
          <button class="btn btn-ghost btn-sit" data-position="${seat.position}">入座</button>
        </div>
      `;
    } else {
      // Avatar with first letter or AI icon
      const avatarChar = seat.isAI ? '🤖' : (seat.nickname ? seat.nickname.charAt(0).toUpperCase() : '?');
      const avatarColor = seat.avatar || '#3498db';

      // Status indicator
      const statusLabel = STATUS_LABELS[seat.status] || '';
      const statusBadge = statusLabel ? `<span class="seat-status">${statusLabel}</span>` : '';

      // Blind/Dealer markers
      const markers = [];
      if (seat.isDealer) markers.push('<span class="marker marker-dealer">D</span>');
      if (seat.isSmallBlind) markers.push('<span class="marker marker-sb">SB</span>');
      if (seat.isBigBlind) markers.push('<span class="marker marker-bb">BB</span>');
      const markersHtml = markers.length ? `<div class="seat-markers">${markers.join('')}</div>` : '';

      // Hole cards
      let cardsHtml = '';
      if (seat.holeCards && seat.holeCards.length === 2) {
        if (isMe || showCards) {
          cardsHtml = `
            <div class="seat-cards">
              ${CardComponent.render(seat.holeCards[0], { small: true }).outerHTML}
              ${CardComponent.render(seat.holeCards[1], { small: true }).outerHTML}
            </div>
          `;
        } else {
          cardsHtml = `
            <div class="seat-cards">
              ${CardComponent.render(null, { small: true, hidden: true }).outerHTML}
              ${CardComponent.render(null, { small: true, hidden: true }).outerHTML}
            </div>
          `;
        }
      }

      // Current bet chips
      let betHtml = '';
      if (seat.currentBet > 0) {
        betHtml = `
          <div class="seat-bet">
            ${ChipsComponent.renderAmount(seat.currentBet, { className: 'seat-bet-amount' }).outerHTML}
          </div>
        `;
      }

      html = `
        <div class="seat-inner">
          ${markersHtml}
          <div class="seat-avatar" style="background:${avatarColor}">${avatarChar}</div>
          <div class="seat-name">${escapeHtml(seat.nickname || '玩家')}</div>
          <div class="seat-chips">${formatChips(seat.chips)}</div>
          ${statusBadge}
          ${cardsHtml}
          ${betHtml}
        </div>
      `;
    }

    el.innerHTML = html;
    return el;
  }

  /**
   * Update an existing seat element without full re-render
   */
  function update(el, seat, options = {}) {
    if (!el) return;

    // Re-render and replace
    const newEl = render(seat, options);
    el.className = newEl.className;
    el.innerHTML = newEl.innerHTML;

    // Preserve any event listeners by keeping the same element reference
    // (Callers should use event delegation instead)
  }

  /**
   * Create an empty seat placeholder for position-based layout
   */
  function renderEmpty(position, maxPlayers = 9) {
    return render({
      position,
      status: 'empty',
    }, {});
  }

  // Helpers
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatChips(n) {
    if (n === undefined || n === null) return '¥0';
    return '¥' + Number(n).toLocaleString();
  }

  return {
    render,
    update,
    renderEmpty,
  };
})();
