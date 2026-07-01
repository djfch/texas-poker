const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement(id = '') {
  let html = '';
  const element = {
    id,
    children: [],
    className: '',
    dataset: {},
    get innerHTML() {
      return html;
    },
    set innerHTML(value) {
      html = value;
      if (value === '') {
        this.children = [];
      }
    },
    style: {},
    textContent: '',
    appendChild(child) {
      child.parentElement = element;
      this.children.push(child);
      return child;
    },
    addEventListener() {},
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    },
    classList: {
      add(...names) {
        element.className = [element.className, ...names].filter(Boolean).join(' ');
      },
      remove(...names) {
        const removeSet = new Set(names);
        element.className = element.className
          .split(/\s+/)
          .filter(name => name && !removeSet.has(name))
          .join(' ');
      },
    },
    querySelector(selector) {
      return this.children.find(child => selector.startsWith('.')
        ? child.className.split(/\s+/).includes(selector.slice(1))
        : child.id === selector.slice(1)) || null;
    },
  };
  return element;
}

function loadTableView() {
  const source = fs.readFileSync(path.join(__dirname, 'table.js'), 'utf8');
  const elements = new Map();
  const listeners = {};
  const renderedCards = [];
  const actions = {
    visible: false,
    hideCalls: 0,
    showCalls: 0,
  };
  const context = {
    ActionsComponent: {
      hide() {
        actions.hideCalls += 1;
        actions.visible = false;
      },
      mount() {},
      setOnAction() {},
      show() {
        actions.showCalls += 1;
        actions.visible = true;
      },
    },
    App: {
      currentRoom: 'ROOM01',
      currentView: 'table',
      navigate() {},
      player: { id: 'human-1' },
      showToast() {},
    },
    CardComponent: {
      render(card) {
        renderedCards.push(card);
        const el = createElement();
        el.card = card;
        return el;
      },
    },
    console,
    document: {
      createElement,
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, createElement(id));
        return elements.get(id);
      },
      querySelectorAll() {
        return [];
      },
    },
    PotComponent: {
      mount() {},
      update() {},
    },
    SeatComponent: {
      render() {
        return createElement();
      },
      update() {},
    },
    SocketClient: {
      gameAction() {},
      leaveRoom() {},
      on(event, callback) {
        listeners[event] = callback;
      },
      requestGameState() {},
    },
    TimerComponent: {
      create() {
        return {
          destroy() {},
          render(container) {
            const timer = createElement();
            timer.className = 'timer';
            container.appendChild(timer);
            return timer;
          },
          start() {},
        };
      },
    },
    setTimeout,
  };

  vm.runInNewContext(
    `${source}\n;globalThis.__TableView = TableView;`,
    context,
    { filename: 'table.js' }
  );
  context.__TableView.init();
  return { actions, elements, listeners, renderedCards };
}

test('public turn event does not hide current player actions', () => {
  const { actions, listeners } = loadTableView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'playing',
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          chips: 1000,
          status: 'occupied',
        },
      ],
    },
  });

  listeners['game:turn']({
    position: 0,
    timeoutAt: Date.now() + 30000,
    validActions: [{ type: 'check' }, { type: 'bet', minAmount: 20, maxAmount: 1000 }],
    currentBet: 0,
    minRaise: 20,
    totalPot: 30,
  });
  assert.equal(actions.visible, true);

  listeners['game:turn']({
    position: 0,
    timeoutAt: Date.now() + 30000,
    currentBet: 0,
    minRaise: 20,
    totalPot: 30,
  });

  assert.equal(actions.visible, true);
});

test('full game state renders current player hole cards', () => {
  const { elements, listeners, renderedCards } = loadTableView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'playing',
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          chips: 1000,
          status: 'occupied',
        },
      ],
    },
  });

  listeners['game:state']({
    gameState: {
      status: 'preflop',
      communityCards: [],
      pots: { mainPot: 30, sidePots: [] },
      currentPosition: 0,
      players: [
        {
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          seatPosition: 0,
          chips: 990,
          bet: 10,
          holeCards: ['A\u2660', 'K\u2665'],
        },
        {
          playerId: 'human-2',
          nickname: 'Other',
          avatar: '#3498db',
          seatPosition: 1,
          chips: 980,
          bet: 20,
          holeCards: null,
        },
      ],
    },
  });

  assert.equal(elements.get('my-hole-cards').children.length, 2);
  assert.deepEqual(renderedCards.slice(-2), ['A\u2660', 'K\u2665']);
});

test('community card event replaces the board with the latest full street', () => {
  const { elements, listeners } = loadTableView();

  listeners['game:community']({
    round: 'flop',
    cards: ['A\u2660', 'K\u2665', '2\u2666'],
  });
  assert.equal(elements.get('community-cards').children.length, 3);

  listeners['game:community']({
    round: 'turn',
    cards: ['A\u2660', 'K\u2665', '2\u2666', '9\u2663'],
  });

  assert.equal(elements.get('community-cards').children.length, 4);
});

test('turn timer is anchored inside the active seat instead of the table ring', () => {
  const { elements, listeners } = loadTableView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'playing',
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          chips: 1000,
          status: 'occupied',
        },
      ],
    },
  });

  const ring = elements.get('seats-ring');
  const seat = ring.children[0];

  listeners['game:turn']({
    position: 0,
    timeoutAt: Date.now() + 30000,
    validActions: [{ type: 'check' }],
    currentBet: 0,
    minRaise: 20,
    totalPot: 30,
  });

  assert.equal(ring.children.length, 9);
  assert.ok(seat.children.some(child => child.className === 'seat-timer-container'));
});

test('turn timer replaces the previous seat timer container', () => {
  const { elements, listeners } = loadTableView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'playing',
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          chips: 1000,
          status: 'occupied',
        },
        {
          position: 1,
          playerId: 'bot-1',
          nickname: 'Bot-Alpha',
          avatar: '#3498db',
          chips: 1000,
          status: 'occupied',
        },
      ],
    },
  });

  const ring = elements.get('seats-ring');
  const firstSeat = ring.children[0];
  const secondSeat = ring.children[1];

  listeners['game:turn']({
    position: 0,
    timeoutAt: Date.now() + 30000,
    validActions: [{ type: 'check' }],
  });

  listeners['game:turn']({
    position: 1,
    timeoutAt: Date.now() + 30000,
  });

  assert.equal(firstSeat.children.filter(child => child.className === 'seat-timer-container').length, 0);
  assert.equal(secondSeat.children.filter(child => child.className === 'seat-timer-container').length, 1);
});
