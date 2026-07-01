/**
 * chips.js - Chip rendering component
 * Renders chip stacks for player bets and visual chip representations.
 */

const ChipsComponent = (function() {
  const CHIP_DENOMINATIONS = [1, 5, 10, 25, 50, 100, 500, 1000, 5000, 10000];

  const CHIP_COLORS = {
    1: { bg: '#ecf0f1', border: '#bdc3c7', text: '#2c3e50' },
    5: { bg: '#e74c3c', border: '#c0392b', text: '#fff' },
    10: { bg: '#3498db', border: '#2980b9', text: '#fff' },
    25: { bg: '#2ecc71', border: '#27ae60', text: '#fff' },
    50: { bg: '#9b59b6', border: '#8e44ad', text: '#fff' },
    100: { bg: '#f1c40f', border: '#d4ac0d', text: '#2c3e50' },
    500: { bg: '#e67e22', border: '#d35400', text: '#fff' },
    1000: { bg: '#2c3e50', border: '#1a252f', text: '#f1c40f' },
    5000: { bg: '#1abc9c', border: '#16a085', text: '#fff' },
    10000: { bg: '#e91e63', border: '#c2185b', text: '#fff' },
  };

  /**
   * Break amount into chip denominations
   */
  function breakIntoChips(amount) {
    const chips = [];
    let remaining = amount;
    // Sort denominations descending
    const denoms = [...CHIP_DENOMINATIONS].sort((a, b) => b - a);
    for (const denom of denoms) {
      while (remaining >= denom) {
        chips.push(denom);
        remaining -= denom;
      }
    }
    // If there's still remaining (shouldn't happen with our denominations), add as 1s
    while (remaining > 0) {
      chips.push(1);
      remaining--;
    }
    return chips;
  }

  /**
   * Render a single chip element
   */
  function renderChip(value) {
    const colors = CHIP_COLORS[value] || CHIP_COLORS[1];
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.style.background = colors.bg;
    chip.style.borderColor = colors.border;
    chip.style.color = colors.text;
    chip.textContent = formatChipValue(value);
    return chip;
  }

  /**
   * Format chip value for display (1k, 5k, etc.)
   */
  function formatChipValue(value) {
    if (value >= 1000) {
      return (value / 1000) + 'k';
    }
    return String(value);
  }

  /**
   * Render a chip stack (multiple chips stacked visually)
   * @param {number} amount - Total amount to represent
   * @param {Object} options - { maxDisplay?, showAmount? }
   * @returns {HTMLElement}
   */
  function renderStack(amount, options = {}) {
    const container = document.createElement('div');
    container.className = 'chip-stack';

    if (amount <= 0) {
      container.style.visibility = 'hidden';
      return container;
    }

    const chips = breakIntoChips(amount);
    const maxDisplay = options.maxDisplay || 6;
    const displayChips = chips.slice(0, maxDisplay);

    displayChips.forEach((value, index) => {
      const chip = renderChip(value);
      chip.style.position = 'absolute';
      chip.style.bottom = `${index * 4}px`;
      chip.style.zIndex = displayChips.length - index;
      container.appendChild(chip);
    });

    // Show "+X more" if there are more chips
    if (chips.length > maxDisplay) {
      const more = document.createElement('div');
      more.className = 'chip-more';
      more.textContent = `+${chips.length - maxDisplay}`;
      container.appendChild(more);
    }

    // Show amount text
    if (options.showAmount !== false) {
      const amountLabel = document.createElement('div');
      amountLabel.className = 'chip-amount-label';
      amountLabel.textContent = '¥' + amount.toLocaleString();
      container.appendChild(amountLabel);
    }

    return container;
  }

  /**
   * Render a simple chip amount display (text only, no visual chips)
   */
  function renderAmount(amount, options = {}) {
    const el = document.createElement('div');
    el.className = 'chip-amount' + (options.className ? ' ' + options.className : '');
    el.textContent = '¥' + amount.toLocaleString();
    return el;
  }

  /**
   * Get color info for a specific chip value
   */
  function getChipColor(value) {
    return CHIP_COLORS[value] || CHIP_COLORS[1];
  }

  return {
    renderStack,
    renderChip,
    renderAmount,
    breakIntoChips,
    formatChipValue,
    getChipColor,
  };
})();
