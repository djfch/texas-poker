/**
 * pot.js - 底池显示组件
 * 在桌面中央渲染主池和边池。
 */

const PotComponent = (function() {
  let currentMainPot = 0;
  let currentSidePots = [];

  /**
   * 渲染底池显示
   * @param {number} mainPot - 主池金额
   * @param {Array} sidePots - [{ amount, eligiblePlayers }]
   * @returns {HTMLElement}
   */
  function render(mainPot, sidePots) {
    currentMainPot = mainPot || 0;
    currentSidePots = sidePots || [];

    const container = document.createElement('div');
    container.className = 'pot-container';
    container.id = 'pot-display-root';

    // 主池
    const mainPotEl = document.createElement('div');
    mainPotEl.className = 'pot-main';
    mainPotEl.innerHTML = `
      <span class="pot-label">底池</span>
      <span class="pot-value" id="pot-value">${formatAmount(currentMainPot)}</span>
    `;
    container.appendChild(mainPotEl);

    // 边池
    if (currentSidePots.length > 0) {
      const sidePotsEl = document.createElement('div');
      sidePotsEl.className = 'pot-sides';
      currentSidePots.forEach((sp, i) => {
        const spEl = document.createElement('div');
        spEl.className = 'pot-side';
        spEl.innerHTML = `
          <span class="pot-side-label">边池 ${i + 1}</span>
          <span class="pot-side-value">${formatAmount(sp.amount)}</span>
        `;
        sidePotsEl.appendChild(spEl);
      });
      container.appendChild(sidePotsEl);
    }

    return container;
  }

  /**
   * 更新底池金额（带动画）
   */
  function update(mainPot, sidePots) {
    const container = document.getElementById('pot-display-root');
    if (!container) return;

    const oldMain = currentMainPot;
    currentMainPot = mainPot || 0;
    currentSidePots = sidePots || [];

    // 主池动画
    const valueEl = container.querySelector('#pot-value');
    if (valueEl && oldMain !== currentMainPot) {
      animateNumber(valueEl, oldMain, currentMainPot, 600);
    }

    // 边池变化时重新渲染
    const sidePotsContainer = container.querySelector('.pot-sides');
    if (currentSidePots.length > 0) {
      if (!sidePotsContainer) {
        const newSidePots = document.createElement('div');
        newSidePots.className = 'pot-sides';
        currentSidePots.forEach((sp, i) => {
          const spEl = document.createElement('div');
          spEl.className = 'pot-side';
          spEl.innerHTML = `
            <span class="pot-side-label">边池 ${i + 1}</span>
            <span class="pot-side-value">${formatAmount(sp.amount)}</span>
          `;
          newSidePots.appendChild(spEl);
        });
        container.appendChild(newSidePots);
      }
    } else if (sidePotsContainer) {
      sidePotsContainer.remove();
    }
  }

  /**
   * 数字动画
   */
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

  /**
   * 格式化金额
   */
  function formatAmount(amount) {
    return '¥' + (amount || 0).toLocaleString();
  }

  /**
   * 直接挂载到底池容器
   */
  function mount(container, mainPot, sidePots) {
    container.innerHTML = '';
    container.appendChild(render(mainPot, sidePots));
  }

  return {
    render,
    update,
    mount,
    formatAmount,
  };
})();
