const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement(id = '') {
  const listeners = {};
  return {
    id,
    children: [],
    className: '',
    dataset: {},
    disabled: false,
    innerHTML: '',
    style: {},
    textContent: '',
    title: '',
    listeners,
    addEventListener(event, callback) {
      listeners[event] = callback;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    classList: {
      add() {},
      remove() {},
    },
    closest() {
      return null;
    },
    querySelector() {
      return null;
    },
  };
}

function loadRoomView() {
  const source = fs.readFileSync(path.join(__dirname, 'room.js'), 'utf8');
  const elements = new Map();
  const listeners = {};
  const context = {
    App: {
      currentRoom: 'ROOM01',
      navigate() {},
      player: { id: 'human-1' },
      showToast() {},
    },
    console,
    document: {
      createElement,
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, createElement(id));
        return elements.get(id);
      },
    },
    SocketClient: {
      on(event, callback) {
        listeners[event] = callback;
      },
      addAICalls: 0,
      addAI() {
        this.addAICalls++;
      },
      removeAICalls: [],
      removeAI(position) {
        this.removeAICalls.push(position);
      },
      ready() {},
      startGame() {},
    },
    setTimeout,
  };

  vm.runInNewContext(
    `${source}\n;globalThis.__RoomView = RoomView;`,
    context,
    { filename: 'room.js' }
  );
  context.__RoomView.init();

  return { elements, listeners, socketClient: context.SocketClient };
}

test('host can start with one ready player when AI fill is allowed', () => {
  const { elements, listeners } = loadRoomView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'AI Room',
      hostId: 'human-1',
      allowAI: true,
      maxPlayers: 6,
      smallBlind: 10,
      bigBlind: 20,
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          isReady: true,
          status: 'occupied',
        },
        { position: 1, status: 'empty' },
      ],
      players: [
        {
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          seatPosition: 0,
          isReady: true,
          chips: 1000,
        },
      ],
    },
  });

  assert.equal(elements.get('btn-room-start').disabled, false);
});

test('seated human can start when room host is an AI player', () => {
  const { elements, listeners } = loadRoomView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'AI Room',
      hostId: 'bot-1',
      allowAI: true,
      maxPlayers: 6,
      smallBlind: 10,
      bigBlind: 20,
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          isReady: true,
          status: 'occupied',
          isAI: false,
        },
        {
          position: 1,
          playerId: 'bot-1',
          nickname: 'Bot-One',
          avatar: '#2ecc71',
          isReady: true,
          status: 'occupied',
          isAI: true,
        },
      ],
      players: [
        {
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          seatPosition: 0,
          isReady: true,
          chips: 1000,
          isAI: false,
        },
        {
          playerId: 'bot-1',
          nickname: 'Bot-One',
          avatar: '#2ecc71',
          seatPosition: 1,
          isReady: true,
          chips: 1000,
          isAI: true,
        },
      ],
    },
  });

  assert.equal(elements.get('btn-room-start').style.display, 'inline-flex');
  assert.equal(elements.get('btn-room-start').disabled, false);
});

test('room controller can add one AI when AI is allowed and seats are open', () => {
  const { elements, listeners, socketClient } = loadRoomView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'AI Room',
      hostId: 'human-1',
      allowAI: true,
      maxPlayers: 6,
      smallBlind: 10,
      bigBlind: 20,
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          isReady: true,
          status: 'occupied',
        },
        { position: 1, status: 'empty' },
      ],
      players: [
        {
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          seatPosition: 0,
          isReady: true,
          chips: 1000,
        },
      ],
    },
  });

  const addAIButton = elements.get('btn-room-add-ai');
  assert.equal(addAIButton.style.display, 'inline-flex');
  assert.equal(addAIButton.disabled, false);

  addAIButton.listeners.click();

  assert.equal(socketClient.addAICalls, 1);
});

test('room controller can remove an AI from a waiting-room seat', () => {
  const { elements, listeners, socketClient } = loadRoomView();

  listeners['room:state']({
    room: {
      id: 'ROOM01',
      name: 'AI Room',
      hostId: 'human-1',
      allowAI: true,
      status: 'waiting',
      maxPlayers: 6,
      smallBlind: 10,
      bigBlind: 20,
      seats: [
        {
          position: 0,
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          isReady: true,
          status: 'occupied',
          isAI: false,
        },
        {
          position: 1,
          playerId: 'bot-1',
          nickname: 'Bot-One',
          avatar: '#2ecc71',
          isReady: true,
          status: 'occupied',
          isAI: true,
        },
      ],
      players: [
        {
          playerId: 'human-1',
          nickname: 'Host',
          avatar: '#2ecc71',
          seatPosition: 0,
          isReady: true,
          chips: 1000,
          isAI: false,
        },
        {
          playerId: 'bot-1',
          nickname: 'Bot-One',
          avatar: '#2ecc71',
          seatPosition: 1,
          isReady: true,
          chips: 1000,
          isAI: true,
        },
      ],
    },
  });

  const aiSeat = elements.get('seats-grid').children[1];
  assert.match(aiSeat.innerHTML, /btn-remove-ai/);
  assert.match(aiSeat.innerHTML, /data-position="1"/);

  const removeButton = {
    dataset: { position: '1' },
    disabled: false,
    textContent: '移除AI',
    closest(selector) {
      return selector === '.btn-remove-ai' ? this : null;
    },
  };
  elements.get('seats-grid').listeners.click({ target: removeButton });

  assert.deepEqual(socketClient.removeAICalls, [1]);
});
