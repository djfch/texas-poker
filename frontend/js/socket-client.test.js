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
