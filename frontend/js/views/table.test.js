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
      const matches = child => selector.startsWith('.')
        ? child.className.split(/\s+/).includes(selector.slice(1))
        : child.id === selector.slice(1);

      const visit = node => {
        for (const child of node.children) {
          if (matches(child)) return child;
          const found = visit(child);
          if (found) return found;
        }
        return null;
      };

      return visit(this);
    },
  };
  return element;
}

function loadTableView() {
  const source = fs.readFileSync(path.join(__dirname, 'table.js'), 'utf8');
  const elements = new Map();
  const listeners = {};
  const renderedCards = [];
  const potCalls = [];
  const socketCalls = {
    borrowChips: 0,
    ready: [],
    startGame: 0,
  };
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
      mount(container, mainPot, sidePots, totalPot) {
        potCalls.push({ type: 'mount', mainPot, sidePots, totalPot });
      },
      update(mainPot, sidePots, totalPot) {
        potCalls.push({ type: 'update', mainPot, sidePots, totalPot });
      },
    },
    SeatComponent: {
      render(seat) {
        const el = createElement();
        el.dataset.position = seat.position;
        const inner = createElement();
        inner.className = 'seat-inner';
        const chips = createElement();
        chips.className = 'seat-chips';
        chips.textContent = '楼' + (Number(seat.chips) || 0).toLocaleString();
        inner.appendChild(chips);
        el.appendChild(inner);
        return el;
      },
      update(el, seat) {
        const inner = el.querySelector('.seat-inner');
        if (!inner) return;
        inner.innerHTML = '';
        let chips = inner.querySelector('.seat-chips');
        if (!chips) {
          chips = createElement();
          chips.className = 'seat-chips';
          inner.appendChild(chips);
        }
        chips.textContent = '楼' + (Number(seat.chips) || 0).toLocaleString();
      },
    },
    SocketClient: {
      borrowChips() {
        socketCalls.borrowChips += 1;
      },
      gameAction() {},
      leaveRoom() {},
      on(event, callback) {
        listeners[event] = callback;
      },
      ready(isReady) {
        socketCalls.ready.push(isReady);
      },
      requestGameState() {},
      startGame() {
        socketCalls.startGame += 1;
      },
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
    setTimeout(callback) {
      callback();
      return 1;
    },
  };

  vm.runInNewContext(
    `${source}\n;globalThis.__TableView = TableView;`,
    context,
    { filename: 'table.js' }
  );
  context.__TableView.init();
  return { actions, elements, listeners, potCalls, renderedCards, socketCalls };
}

test('showdown creates a seat cards container when an opponent was previously hidden', () => {
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
          playerId: 'human-2',
          nickname: 'Other',
          avatar: '#3498db',
          chips: 1000,
          status: 'occupied',
        },
      ],
    },
  });

  listeners['game:showdown']({
    results: [
      { position: 1, playerId: 'human-2', cards: ['Q\u2663', 'Q\u2666'], handName: null },
    ],
  });

  const secondSeatInner = elements.get('seats-ring').children[1].querySelector('.seat-inner');
  const cards = secondSeatInner.querySelector('.seat-cards');
  assert.ok(cards);
  assert.equal(cards.children.length, 2);
});

test('showdown hand names stay visible through next-hand waiting room refresh', () => {
  const { elements, listeners } = loadTableView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'playing',
      seats: [
        { position: 0, playerId: 'human-1', nickname: 'Host', avatar: '#2ecc71', chips: 1000, status: 'occupied' },
        { position: 1, playerId: 'human-2', nickname: 'Other', avatar: '#3498db', chips: 1000, status: 'occupied' },
      ],
    },
  });

  listeners['game:state']({
    gameState: {
      status: 'river',
      communityCards: ['4\u2660', '5\u2665', '6\u2666', '7\u2663', 'K\u2660'],
      pots: { mainPot: 2000, sidePots: [] },
      totalPot: 2000,
      currentPosition: 0,
      players: [
        { playerId: 'human-1', nickname: 'Host', avatar: '#2ecc71', seatPosition: 0, chips: 0, bet: 0, holeCards: ['8\u2660', '2\u2665'] },
        { playerId: 'human-2', nickname: 'Other', avatar: '#3498db', seatPosition: 1, chips: 0, bet: 0, holeCards: null },
      ],
    },
  });

  listeners['game:showdown']({
    results: [
      { position: 0, playerId: 'human-1', cards: ['8\u2660', '2\u2665'], handName: '\u987a\u5b50' },
      { position: 1, playerId: 'human-2', cards: ['4\u2663', '4\u2666'], handName: '\u4e00\u5bf9' },
    ],
  });
  listeners['game:ended']({
    handResults: [
      { playerId: 'human-1', position: 0, nickname: 'Host', delta: 1000, chips: 2000, isWinner: true },
      { playerId: 'human-2', position: 1, nickname: 'Other', delta: -1000, chips: 0, isWinner: false },
    ],
  });

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'waiting',
      awaitingNextHandReady: true,
      seats: [
        { position: 0, playerId: 'human-1', nickname: 'Host', avatar: '#2ecc71', chips: 2000, isReady: false, status: 'occupied' },
        { position: 1, playerId: 'human-2', nickname: 'Other', avatar: '#3498db', chips: 0, isReady: false, status: 'occupied' },
      ],
    },
  });

  const firstSeatInner = elements.get('seats-ring').children[0].querySelector('.seat-inner');
  const secondSeatInner = elements.get('seats-ring').children[1].querySelector('.seat-inner');
  assert.equal(firstSeatInner.querySelector('.seat-hand-name').textContent, '\u987a\u5b50');
  assert.equal(secondSeatInner.querySelector('.seat-hand-name').textContent, '\u4e00\u5bf9');
});

test('game ended renders seat deltas without opening the result modal', () => {
  const { elements, listeners, socketCalls } = loadTableView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'waiting',
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          chips: 990,
          isReady: false,
          status: 'occupied',
        },
        {
          position: 1,
          playerId: 'human-2',
          nickname: 'Other',
          avatar: '#3498db',
          chips: 1010,
          isReady: true,
          status: 'occupied',
        },
      ],
    },
  });

  listeners['game:ended']({
    handResults: [
      { playerId: 'human-1', position: 0, nickname: 'Host', delta: -10, chips: 990, isWinner: false },
      { playerId: 'human-2', position: 1, nickname: 'Other', delta: 10, chips: 1010, isWinner: true },
    ],
  });

  const firstSeatInner = elements.get('seats-ring').children[0].querySelector('.seat-inner');
  const secondSeatInner = elements.get('seats-ring').children[1].querySelector('.seat-inner');

  assert.notEqual(elements.get('modal-result').style.display, 'flex');
  assert.match(firstSeatInner.querySelector('.seat-hand-result').textContent, /-¥10/);
  assert.match(secondSeatInner.querySelector('.seat-hand-result').textContent, /\+¥10/);
  assert.match(elements.get('seats-ring').children[1].className, /seat-winner/);
  assert.deepEqual(socketCalls.ready, []);
  assert.equal(socketCalls.startGame, 0);
});

test('room state chip updates are not overwritten by lingering hand result labels', () => {
  const { elements, listeners } = loadTableView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'waiting',
      awaitingNextHandReady: true,
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          chips: 0,
          isReady: false,
          status: 'occupied',
        },
      ],
    },
  });

  listeners['game:ended']({
    handResults: [
      { playerId: 'human-1', position: 0, nickname: 'Host', delta: -1000, chips: 0, isWinner: false },
    ],
  });

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'waiting',
      awaitingNextHandReady: true,
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          chips: 1000,
          isReady: false,
          status: 'occupied',
        },
      ],
    },
  });

  const seatInner = elements.get('seats-ring').children[0].querySelector('.seat-inner');
  assert.equal(seatInner.querySelector('.seat-chips').textContent, '楼1,000');
  assert.match(seatInner.querySelector('.seat-hand-result').textContent, /-¥1,000/);
});

test('next hand action button borrows first, then readies after chips are available', () => {
  const { elements, listeners, socketCalls } = loadTableView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'waiting',
      awaitingNextHandReady: true,
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          chips: 0,
          isReady: false,
          status: 'occupied',
        },
      ],
    },
  });

  const nextAction = elements.get('btn-table-next-action');
  assert.match(nextAction.textContent, /借筹码/);
  nextAction.onclick();
  assert.equal(socketCalls.borrowChips, 1);

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'waiting',
      awaitingNextHandReady: true,
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          chips: 1000,
          isReady: false,
          status: 'occupied',
        },
      ],
    },
  });

  assert.match(nextAction.textContent, /准备/);
  nextAction.onclick();
  assert.deepEqual(socketCalls.ready, [true]);
  assert.equal(socketCalls.startGame, 0);
});

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

test('full game state updates visible seat bet chips', () => {
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
          chips: 990,
          status: 'occupied',
        },
        {
          position: 1,
          playerId: 'human-2',
          nickname: 'Other',
          avatar: '#3498db',
          chips: 980,
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

  const firstSeatInner = elements.get('seats-ring').children[0].querySelector('.seat-inner');
  const secondSeatInner = elements.get('seats-ring').children[1].querySelector('.seat-inner');

  assert.match(firstSeatInner.querySelector('.seat-bet').innerHTML, /¥10/);
  assert.match(secondSeatInner.querySelector('.seat-bet').innerHTML, /¥20/);
});

test('full game state hides side pot details until a player is all-in', () => {
  const { listeners, potCalls } = loadTableView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'playing',
      seats: [
        { position: 0, playerId: 'human-1', nickname: 'Host', avatar: '#2ecc71', chips: 990, status: 'occupied' },
        { position: 1, playerId: 'human-2', nickname: 'Other', avatar: '#3498db', chips: 980, status: 'occupied' },
      ],
    },
  });

  listeners['game:state']({
    gameState: {
      status: 'preflop',
      communityCards: [],
      pots: { mainPot: 20, sidePots: [{ amount: 10 }] },
      totalPot: 30,
      currentPosition: 0,
      players: [
        { playerId: 'human-1', nickname: 'Host', avatar: '#2ecc71', seatPosition: 0, chips: 990, bet: 10, allIn: false, holeCards: ['A\u2660', 'K\u2665'] },
        { playerId: 'human-2', nickname: 'Other', avatar: '#3498db', seatPosition: 1, chips: 980, bet: 20, allIn: false, holeCards: null },
      ],
    },
  });

  assert.equal(potCalls.at(-1).sidePots.length, 0);
  assert.equal(potCalls.at(-1).totalPot, 30);
});

test('full game state keeps side pot details when a player is all-in', () => {
  const { listeners, potCalls } = loadTableView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'Table',
      smallBlind: 10,
      bigBlind: 20,
      status: 'playing',
      seats: [
        { position: 0, playerId: 'human-1', nickname: 'Host', avatar: '#2ecc71', chips: 0, status: 'occupied' },
        { position: 1, playerId: 'human-2', nickname: 'Other', avatar: '#3498db', chips: 100, status: 'occupied' },
      ],
    },
  });

  listeners['game:state']({
    gameState: {
      status: 'preflop',
      communityCards: [],
      pots: { mainPot: 200, sidePots: [{ amount: 100 }] },
      totalPot: 300,
      currentPosition: 1,
      players: [
        { playerId: 'human-1', nickname: 'Host', avatar: '#2ecc71', seatPosition: 0, chips: 0, bet: 100, allIn: true, holeCards: ['A\u2660', 'K\u2665'] },
        { playerId: 'human-2', nickname: 'Other', avatar: '#3498db', seatPosition: 1, chips: 100, bet: 200, allIn: false, holeCards: null },
      ],
    },
  });

  assert.equal(potCalls.at(-1).sidePots.length, 1);
  assert.equal(potCalls.at(-1).sidePots[0].amount, 100);
  assert.equal(potCalls.at(-1).totalPot, 300);
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

test('pot event updates seat bet chips from server player payload', () => {
  const { elements, listeners, potCalls } = loadTableView();

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
          chips: 990,
          status: 'occupied',
        },
        {
          position: 1,
          playerId: 'human-2',
          nickname: 'Other',
          avatar: '#3498db',
          chips: 980,
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

  listeners['game:pot']({
    mainPot: 40,
    sidePots: [],
    totalPot: 40,
    players: [
      { playerId: 'human-1', position: 0, chips: 980, bet: 20, totalBet: 20 },
      { playerId: 'human-2', position: 1, chips: 980, bet: 20, totalBet: 20 },
    ],
  });

  const firstSeatInner = elements.get('seats-ring').children[0].querySelector('.seat-inner');
  const firstBet = firstSeatInner.querySelector('.seat-bet');

  assert.match(firstBet.innerHTML, /¥20/);
  assert.equal(elements.get('my-chips').textContent, '¥980');
  assert.equal(potCalls.at(-1).totalPot, 40);
});
