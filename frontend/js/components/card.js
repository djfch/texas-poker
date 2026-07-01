/**
 * card.js - Poker Card rendering component
 * Renders individual cards and card groups with front/back support and animations.
 */

const CardComponent = (function() {
  const SUIT_SYMBOLS = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠',
  };

  const SUIT_COLORS = {
    hearts: 'red',
    diamonds: 'red',
    clubs: 'black',
    spades: 'black',
  };

  /**
   * Render a single card
   * @param {Object|null} card - { suit, rank } or null for back
   * @param {Object} options - { small?, hidden?, animate?, className? }
   * @returns {HTMLElement}
   */
  function render(card, options = {}) {
    const el = document.createElement('div');
    const isSmall = options.small === true;
    const isHidden = options.hidden === true;
    const animate = options.animate === true;

    el.className = 'card';
    if (isSmall) el.classList.add('card-small');
    if (animate) el.classList.add('card-animate');
    if (options.className) el.classList.add(options.className);

    if (!card || isHidden) {
      // Card back
      el.classList.add('card-back');
      el.innerHTML = `
        <div class="card-back-pattern"></div>
      `;
    } else {
      // Card front
      const suit = card.suit;
      const rank = card.rank;
      const symbol = SUIT_SYMBOLS[suit] || '';
      const colorClass = SUIT_COLORS[suit] === 'red' ? 'card-red' : 'card-black';

      el.classList.add(colorClass);
      el.dataset.suit = suit;
      el.dataset.rank = rank;

      const rankDisplay = rank;
      const isFace = ['J', 'Q', 'K'].includes(rank);
      const isAce = rank === 'A';

      el.innerHTML = `
        <div class="card-corner card-corner-tl">
          <span class="card-rank">${rankDisplay}</span>
          <span class="card-suit">${symbol}</span>
        </div>
        <div class="card-center">
          ${isFace ? `<span class="card-face">${rank}</span>` : ''}
          ${isAce ? `<span class="card-ace">A</span>` : ''}
          ${!isFace && !isAce ? `<span class="card-big-suit">${symbol}</span>` : ''}
        </div>
        <div class="card-corner card-corner-br">
          <span class="card-rank">${rankDisplay}</span>
          <span class="card-suit">${symbol}</span>
        </div>
      `;
    }

    return el;
  }

  /**
   * Render a group of cards in a container
   */
  function renderCards(cards, options = {}) {
    const container = document.createElement('div');
    container.className = 'cards-container';
    if (options.className) container.classList.add(options.className);

    (cards || []).forEach((card, index) => {
      const cardEl = render(card, {
        ...options,
        animate: options.animate ? true : false,
      });
      if (options.animate) {
        cardEl.style.animationDelay = `${index * 0.1}s`;
      }
      container.appendChild(cardEl);
    });

    return container;
  }

  /**
   * Get the CSS color class for a suit
   */
  function getSuitColor(suit) {
    return SUIT_COLORS[suit] || 'black';
  }

  /**
   * Get the symbol for a suit
   */
  function getSuitSymbol(suit) {
    return SUIT_SYMBOLS[suit] || '';
  }

  /**
   * Animate dealing a card to a target element
   */
  function animateDeal(card, targetContainer, options = {}) {
    return new Promise((resolve) => {
      const cardEl = render(card, { ...options, animate: true });
      cardEl.style.position = 'absolute';
      cardEl.style.left = '50%';
      cardEl.style.top = '50%';
      cardEl.style.transform = 'translate(-50%, -50%) scale(0.3)';
      cardEl.style.opacity = '0';
      cardEl.style.zIndex = '100';
      cardEl.style.transition = 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';

      const table = document.querySelector('.table-surface') || document.body;
      table.appendChild(cardEl);

      // Force reflow
      cardEl.offsetHeight;

      // Get target position
      const targetRect = targetContainer.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();

      const finalLeft = targetRect.left - tableRect.left + targetRect.width / 2;
      const finalTop = targetRect.top - tableRect.top + targetRect.height / 2;

      cardEl.style.left = `${finalLeft}px`;
      cardEl.style.top = `${finalTop}px`;
      cardEl.style.transform = 'translate(-50%, -50%) scale(1)';
      cardEl.style.opacity = '1';

      setTimeout(() => {
        cardEl.style.position = '';
        cardEl.style.left = '';
        cardEl.style.top = '';
        cardEl.style.transform = '';
        cardEl.style.zIndex = '';
        cardEl.style.transition = '';
        targetContainer.appendChild(cardEl);
        resolve(cardEl);
      }, 450);
    });
  }

  /**
   * Flip a card from back to front (or vice versa)
   */
  function flipCard(cardEl, card, options = {}) {
    return new Promise((resolve) => {
      cardEl.style.transition = 'transform 0.3s ease';
      cardEl.style.transform = 'rotateY(90deg)';

      setTimeout(() => {
        // Replace content
        const newCard = render(card, options);
        cardEl.innerHTML = newCard.innerHTML;
        cardEl.className = newCard.className;

        cardEl.style.transform = 'rotateY(0deg)';
        setTimeout(() => {
          cardEl.style.transition = '';
          cardEl.style.transform = '';
          resolve(cardEl);
        }, 300);
      }, 300);
    });
  }

  return {
    render,
    renderCards,
    getSuitColor,
    getSuitSymbol,
    animateDeal,
    flipCard,
    SUITS: SUIT_SYMBOLS,
  };
})();
