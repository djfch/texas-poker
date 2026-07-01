/**
 * timer.js - Countdown timer component
 * Shows a circular progress countdown for player action time limit.
 */

const TimerComponent = (function() {
  const DEFAULT_DURATION = 30000; // 30 seconds
  const DEFAULT_WARNING = 10000;  // 10 seconds warning

  /**
   * Factory: create an independent timer instance.
   */
  function create() {
    let timerEl = null;
    let intervalId = null;
    let endTime = 0;
    let duration = DEFAULT_DURATION;
    let warningMs = DEFAULT_WARNING;

    function createElement() {
      const el = document.createElement('div');
      el.className = 'timer';
      el.innerHTML = `
        <svg class="timer-ring" viewBox="0 0 60 60">
          <circle class="timer-track" cx="30" cy="30" r="26"/>
          <circle class="timer-progress" cx="30" cy="30" r="26"/>
        </svg>
        <span class="timer-text">30</span>
      `;
      return el;
    }

    function render(container, opts = {}) {
      duration = opts.duration || DEFAULT_DURATION;
      warningMs = opts.warning || DEFAULT_WARNING;

      timerEl = createElement();
      container.appendChild(timerEl);
      return timerEl;
    }

    function start(endTimestamp) {
      endTime = endTimestamp;
      stop();

      if (!timerEl) return;

      const progressCircle = timerEl.querySelector('.timer-progress');
      const textEl = timerEl.querySelector('.timer-text');
      const circumference = 2 * Math.PI * 26;

      progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;

      function tick() {
        const now = Date.now();
        const remaining = Math.max(0, endTime - now);
        const elapsed = duration - remaining;
        const pct = elapsed / duration;
        const offset = circumference * pct;

        progressCircle.style.strokeDashoffset = offset;

        const seconds = Math.ceil(remaining / 1000);
        textEl.textContent = seconds;

        if (remaining <= warningMs) {
          timerEl.classList.add('timer-warning');
        } else {
          timerEl.classList.remove('timer-warning');
        }

        if (remaining <= 0) {
          stop();
          timerEl.classList.add('timer-expired');
        }
      }

      tick();
      intervalId = setInterval(tick, 100);
    }

    function stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (timerEl) {
        timerEl.classList.remove('timer-warning', 'timer-expired');
      }
    }

    function destroy() {
      stop();
      if (timerEl) {
        timerEl.remove();
        timerEl = null;
      }
    }

    function getRemaining() {
      return Math.max(0, endTime - Date.now());
    }

    return {
      render,
      start,
      stop,
      destroy,
      getRemaining,
      get element() { return timerEl; },
    };
  }

  return {
    create,
  };
})();
