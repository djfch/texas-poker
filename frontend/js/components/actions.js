/**
 * actions.js - 玩家操作按钮组件
 * 根据有效操作渲染 弃牌/过牌/跟注/加注/全押 按钮。
 */

const ActionsComponent = (function() {
  let containerEl = null;
  let currentValidActions = [];
  let onActionCallback = null;
  let isVisible = false;

  /**
   * 挂载操作栏到容器
   */
  function mount(container) {
    containerEl = container;
    containerEl.innerHTML = '';
    containerEl.style.display = 'none';
    isVisible = false;
  }

  /**
   * 根据服务器返回的有效操作显示按钮
   * @param {Array} validActions - [{ type, minAmount?, maxAmount? }]
   * @param {Object} context - { currentBet, myChips, pot }
   */
  function show(validActions, context = {}) {
    currentValidActions = validActions || [];
    if (!containerEl) return;

    containerEl.innerHTML = '';
    containerEl.style.display = 'flex';
    isVisible = true;

    const { currentBet = 0, myChips = 0, pot = 0 } = context;

    // 按顺序排列：弃牌、过牌、跟注、下注、加注、全押
    const order = { fold: 0, check: 1, call: 2, bet: 3, raise: 4, allin: 5 };
    const sorted = [...currentValidActions].sort((a, b) => (order[a.type] || 99) - (order[b.type] || 99));

    sorted.forEach(action => {
      const btn = createActionButton(action, context);
      containerEl.appendChild(btn);
    });

    // 如果可加注，添加加注输入框
    const hasRaise = sorted.some(a => a.type === 'raise' || a.type === 'bet');
    if (hasRaise) {
      addRaiseInput(sorted.find(a => a.type === 'raise' || a.type === 'bet'), context);
    }
  }

  /**
   * 隐藏操作栏
   */
  function hide() {
    if (!containerEl) return;
    containerEl.style.display = 'none';
    containerEl.innerHTML = '';
    isVisible = false;
    currentValidActions = [];
  }

  /**
   * 设置操作回调
   */
  function setOnAction(callback) {
    onActionCallback = callback;
  }

  /**
   * 检查操作栏是否可见
   */
  function visible() {
    return isVisible;
  }

  // ============================================================
  // 按钮创建
  // ============================================================

  function createActionButton(action, context) {
    const btn = document.createElement('button');
    btn.className = 'btn action-btn';

    const { type, minAmount, maxAmount } = action;

    switch (type) {
      case 'fold':
        btn.classList.add('btn-danger', 'action-fold');
        btn.textContent = '弃牌';
        break;
      case 'check':
        btn.classList.add('btn-ghost', 'action-check');
        btn.textContent = '过牌';
        break;
      case 'call':
        btn.classList.add('btn-secondary', 'action-call');
        btn.textContent = `跟注 ${formatAmount(minAmount || context.currentBet)}`;
        break;
      case 'bet':
        btn.classList.add('btn-primary', 'action-bet');
        btn.textContent = `下注`;
        btn.dataset.action = 'bet';
        break;
      case 'raise':
        btn.classList.add('btn-warning', 'action-raise');
        btn.textContent = `加注`;
        btn.dataset.action = 'raise';
        break;
      case 'allin':
        btn.classList.add('btn-info', 'action-allin');
        btn.textContent = `全押 ${formatAmount(maxAmount || context.myChips)}`;
        break;
      default:
        btn.textContent = type;
    }

    btn.addEventListener('click', () => {
      if (type === 'bet' || type === 'raise') {
        const input = containerEl.querySelector('.raise-input');
        let amount = input ? Number(input.value) : (minAmount || 0);
        if (!Number.isFinite(amount)) amount = 0;
        amount = Math.max(minAmount || 0, Math.min(amount, maxAmount || amount));
        if (amount < (minAmount || 0)) {
          App.showToast(`金额至少为 ¥${(minAmount || 0).toLocaleString()}`, 'warning');
          return;
        }
        emitAction(type, amount);
      } else if (type === 'call') {
        emitAction('call', minAmount || context.currentBet);
      } else {
        emitAction(type);
      }
    });

    return btn;
  }

  /**
   * 添加加注/下注金额输入框和快捷按钮
   */
  function addRaiseInput(action, context) {
    if (!action) return;

    const minAmount = action.minAmount || 0;
    const maxAmount = action.maxAmount || context.myChips || 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'raise-wrapper';

    // 输入框
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'input raise-input';
    input.min = minAmount;
    input.max = maxAmount;
    input.value = minAmount;

    // 快捷按钮
    const quickBtns = document.createElement('div');
    quickBtns.className = 'raise-quick-buttons';

    const quickValues = [
      { label: '最小', value: minAmount },
      { label: '半池', value: Math.floor((context.pot || 0) / 2) },
      { label: '满池', value: context.pot || 0 },
      { label: '最大', value: maxAmount },
    ];

    quickValues.forEach(qv => {
      const qBtn = document.createElement('button');
      qBtn.className = 'btn btn-ghost btn-sm';
      qBtn.textContent = qv.label;
      qBtn.addEventListener('click', () => {
        input.value = Math.min(Math.max(qv.value, minAmount), maxAmount);
      });
      quickBtns.appendChild(qBtn);
    });

    // 滑块
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'raise-slider';
    slider.min = minAmount;
    slider.max = maxAmount;
    slider.value = minAmount;
    slider.addEventListener('input', (e) => {
      input.value = e.target.value;
    });
    input.addEventListener('input', (e) => {
      slider.value = e.target.value;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(quickBtns);
    wrapper.appendChild(slider);

    containerEl.appendChild(wrapper);
  }

  /**
   * 调用已注册的回调
   */
  function emitAction(type, amount) {
    if (typeof onActionCallback === 'function') {
      onActionCallback(type, amount);
    }
  }

  function formatAmount(n) {
    if (n === undefined || n === null) return '¥0';
    return '¥' + Number(n).toLocaleString();
  }

  return {
    mount,
    show,
    hide,
    setOnAction,
    visible,
  };
})();
