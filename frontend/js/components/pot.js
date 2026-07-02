/**
 * pot.js - pot display component
 * The primary number shows totalPot(总底池); side pots are shown as detail.
 */

const PotComponent = (function() {
  let currentTotalPot = 0;
  let currentSidePots = [];

  function render(mainPot, sidePots, totalPot) {
    currentSidePots = sidePots || [];
    currentTotalPot = resolveTotalPot(mainPot, currentSidePots, totalPot);

    const container = document.createElement('div');
    container.className = 'pot-container';
    container.id = 'pot-display-root';

    const mainPotEl = document.createElement('div');
    mainPotEl.className = 'pot-main';
    mainPotEl.innerHTML = `
      <span class="pot-label">底池</span>
      <span class="pot-value" id="pot-value">${formatAmount(currentTotalPot)}</span>
    `;
    container.appendChild(mainPotEl);

    renderSidePots(container, currentSidePots);
    return container;
  }

  function update(mainPot, sidePots, totalPot) {
    const container = document.getElementById('pot-display-root');
    if (!container) return;

    const oldTotal = currentTotalPot;
    currentSidePots = sidePots || [];
    currentTotalPot = resolveTotalPot(mainPot, currentSidePots, totalPot);

    const valueEl = container.querySelector('#pot-value');
    if (valueEl && oldTotal !== currentTotalPot) {
      animateNumber(valueEl, oldTotal, currentTotalPot, 600);
    }

    renderSidePots(container, currentSidePots);
  }

  function resolveTotalPot(mainPot, sidePots, totalPot) {
    const explicitTotal = Number(totalPot);
    if (Number.isFinite(explicitTotal)) return explicitTotal;

    return toAmount(mainPot) + (sidePots || []).reduce((sum, sidePot) => {
      return sum + toAmount(sidePot && sidePot.amount);
    }, 0);
  }

  function renderSidePots(container, sidePots) {
    let sidePotsContainer = container.querySelector('.pot-sides');

    if (!sidePots || sidePots.length === 0) {
      if (sidePotsContainer) sidePotsContainer.remove();
      return;
    }

    if (!sidePotsContainer) {
      sidePotsContainer = document.createElement('div');
      sidePotsContainer.className = 'pot-sides';
      container.appendChild(sidePotsContainer);
    }

    sidePotsContainer.innerHTML = '';
    sidePots.forEach((sp, i) => {
      const spEl = document.createElement('div');
      spEl.className = 'pot-side';
      spEl.innerHTML = `
        <span class="pot-side-label">边池 ${i + 1}</span>
        <span class="pot-side-value">${formatAmount(sp.amount)}</span>
      `;
      sidePotsContainer.appendChild(spEl);
    });
  }

  function toAmount(amount) {
    const value = Number(amount);
    return Number.isFinite(value) ? value : 0;
  }

  function animateNumber(el, from, to, duration) {
    const startTime = performance.now();
    const diff = to - from;

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + diff * eased);
      el.textContent = formatAmount(current);

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }

  function formatAmount(amount) {
    return '¥' + (amount || 0).toLocaleString();
  }

  function mount(container, mainPot, sidePots, totalPot) {
    container.innerHTML = '';
    container.appendChild(render(mainPot, sidePots, totalPot));
  }

  return {
    render,
    update,
    mount,
    formatAmount,
  };
})();
