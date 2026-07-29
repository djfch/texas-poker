/**
 * backend/socket/auth-connection.test.ts
 *
 * Connection-time authentication tests: JWT via handshake.auth.token is
 * authoritative, invalid/expired tokens are rejected, and the legacy
 * query.playerId path keeps working during the compatibility window.
 * Run with: node --import tsx --test backend/socket/auth-connection.test.ts
 */

const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const authService = require('../services/auth-service');
const store = require('../storage/memory-store');
const { setupSocketHandlers } = require('./handlers');

function resetStore() {
  store.players.clear();
  store.rooms.clear();
  store.games.clear();
  store.sockets.clear();
  store.playerSockets.clear();
}

async function createPlayer(id: string) {
  const player = {
    id,
    nickname: id,
    avatar: '#2ecc71',
    chips: 1000,
    isGuest: true,
    isOnline: false,
    currentRoom: null,
  };
  await store.createPlayer(player);
  return player;
}

function createIoRecorder() {
  return {
    handlers: {} as Record<string, (...args: any[]) => any>,
    on(event: string, callback: (...args: any[]) => any) {
      this.handlers[event] = callback;
    },
    to(_target: string) {
      return { emit(_event: string, _payload: any) {} };
    },
  };
}

function createSocketRecorder(id: string, handshake: { query?: any; auth?: any }) {
  return {
    id,
    handshake: { query: handshake.query ?? {}, auth: handshake.auth ?? {} },
    handlers: {} as Record<string, (...args: any[]) => any>,
    emitted: [] as any[],
    disconnected: false,
    on(event: string, callback: (...args: any[]) => any) {
      this.handlers[event] = callback;
    },
    emit(event: string, payload: any) {
      this.emitted.push({ event, payload });
    },
    join(_roomId: string) {},
    leave(_roomId: string) {},
    disconnect() {
      this.disconnected = true;
    },
  };
}

async function waitFor(predicate: () => any) {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail('Timed out waiting for condition');
}

function connectedPayload(socket: any) {
  return socket.emitted.find((e: any) => e.event === 'connected')?.payload;
}

test.afterEach(() => {
  resetStore();
});

test('a valid token binds the connection to the token playerId', async () => {
  await createPlayer('user-1');
  const token = authService.signToken('user-1', 'user');
  const io = createIoRecorder();
  const socket = createSocketRecorder('sock-1', { auth: { token } });

  setupSocketHandlers(io);
  io.handlers.connection(socket);
  await waitFor(() => connectedPayload(socket));

  assert.equal(connectedPayload(socket).playerId, 'user-1');
  assert.equal(await store.getSocketByPlayerId('user-1'), 'sock-1');
});

test('a valid token takes precedence over a conflicting query playerId', async () => {
  await createPlayer('user-1');
  await createPlayer('user-2');
  const token = authService.signToken('user-1', 'user');
  const io = createIoRecorder();
  const socket = createSocketRecorder('sock-1', {
    auth: { token },
    query: { playerId: 'user-2' },
  });

  setupSocketHandlers(io);
  io.handlers.connection(socket);
  await waitFor(() => connectedPayload(socket));

  assert.equal(connectedPayload(socket).playerId, 'user-1');
  assert.equal(await store.getSocketByPlayerId('user-2'), null);
});

test('an invalid token rejects the connection and creates nothing', async () => {
  const io = createIoRecorder();
  const socket = createSocketRecorder('sock-1', { auth: { token: 'forged-token' } });

  setupSocketHandlers(io);
  io.handlers.connection(socket);
  await waitFor(() => socket.disconnected);

  const error = socket.emitted.find((e: any) => e.event === 'error');
  assert.equal(error?.payload?.code, 'AUTH_INVALID');
  assert.equal(connectedPayload(socket), undefined);
  assert.equal((await store.listPlayers()).length, 0);
});

test('an expired token is rejected the same way', async () => {
  const expired = authService.signToken('user-1', 'user', '-10s');
  const io = createIoRecorder();
  const socket = createSocketRecorder('sock-1', { auth: { token: expired } });

  setupSocketHandlers(io);
  io.handlers.connection(socket);
  await waitFor(() => socket.disconnected);

  const error = socket.emitted.find((e: any) => e.event === 'error');
  assert.equal(error?.payload?.code, 'AUTH_INVALID');
  assert.equal(connectedPayload(socket), undefined);
});

test('the legacy query playerId path still rebinds an existing player', async () => {
  await createPlayer('legacy-1');
  const io = createIoRecorder();
  const socket = createSocketRecorder('sock-1', { query: { playerId: 'legacy-1' } });

  setupSocketHandlers(io);
  io.handlers.connection(socket);
  await waitFor(() => connectedPayload(socket));

  assert.equal(connectedPayload(socket).playerId, 'legacy-1');
  assert.equal(await store.getSocketByPlayerId('legacy-1'), 'sock-1');
});

test('a connection without any identity creates a guest and issues a token', async () => {
  const io = createIoRecorder();
  const socket = createSocketRecorder('sock-1', {});

  setupSocketHandlers(io);
  io.handlers.connection(socket);
  await waitFor(() => connectedPayload(socket));

  const payload = connectedPayload(socket);
  assert.ok(payload.playerId);
  assert.deepEqual(authService.verifyToken(payload.token), {
    playerId: payload.playerId,
    type: 'guest',
  });
  assert.equal(await store.getSocketByPlayerId(payload.playerId), 'sock-1');
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
