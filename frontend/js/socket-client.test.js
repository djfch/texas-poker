const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSocketClient() {
  const source = fs.readFileSync(path.join(__dirname, 'socket-client.js'), 'utf8');
  let socket = null;
  const context = {
    console,
    io() {
      socket = {
        connected: true,
        emitted: [],
        handlers: {},
        disconnect() {},
        emit(event, payload) {
          this.emitted.push({ event, payload });
        },
        on(event, callback) {
          this.handlers[event] = callback;
        },
      };
      return socket;
    },
  };

  vm.runInNewContext(
    `${source}\n;globalThis.__SocketClient = SocketClient;`,
    context,
    { filename: 'socket-client.js' }
  );

  return { SocketClient: context.__SocketClient, getSocket: () => socket };
}

test('forwards server connected event to local subscribers', () => {
  const { SocketClient, getSocket } = loadSocketClient();
  let payload = null;

  SocketClient.on('connected', data => {
    payload = data;
  });
  SocketClient.connect('stale-player');

  getSocket().handlers.connected({ playerId: 'fresh-player' });

  assert.deepEqual(payload, { playerId: 'fresh-player' });
});

test('removeAI emits the AI seat position', () => {
  const { SocketClient, getSocket } = loadSocketClient();
  SocketClient.connect('player-1');

  SocketClient.removeAI(3);

  const emitted = getSocket().emitted.at(-1);
  assert.equal(emitted.event, 'room:remove_ai');
  assert.equal(emitted.payload.position, 3);
});

test('borrowChips emits the room borrow event', () => {
  const { SocketClient, getSocket } = loadSocketClient();
  SocketClient.connect('player-1');

  SocketClient.borrowChips();

  const emitted = getSocket().emitted.at(-1);
  assert.equal(emitted.event, 'room:borrow_chips');
  assert.equal(emitted.payload, undefined);
});

test('updateNickname emits the player nickname update event', () => {
  const { SocketClient, getSocket } = loadSocketClient();
  SocketClient.connect('player-1');

  SocketClient.updateNickname('New Name');

  const emitted = getSocket().emitted.at(-1);
  assert.equal(emitted.event, 'player:update_nickname');
  assert.equal(emitted.payload.nickname, 'New Name');
});

test('forwards player updated events to local subscribers', () => {
  const { SocketClient, getSocket } = loadSocketClient();
  let received = null;

  SocketClient.on('player:updated', data => {
    received = data;
  });
  SocketClient.connect('player-1');

  getSocket().handlers['player:updated']({
    player: { id: 'player-1', nickname: 'New Name' },
  });

  assert.deepEqual(received, {
    player: { id: 'player-1', nickname: 'New Name' },
  });
});

test('forwards settlement events to local subscribers', () => {
  const { SocketClient, getSocket } = loadSocketClient();
  const received = [];

  SocketClient.on('room:settlement', data => received.push(['single', data]));
  SocketClient.on('room:settled', data => received.push(['all', data]));
  SocketClient.connect('player-1');

  getSocket().handlers['room:settlement']({ settlement: { netResult: -100 } });
  getSocket().handlers['room:settled']({ settlements: [] });

  assert.deepEqual(received, [
    ['single', { settlement: { netResult: -100 } }],
    ['all', { settlements: [] }],
  ]);
});
