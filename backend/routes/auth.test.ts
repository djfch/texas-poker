/**
 * backend/routes/auth.test.ts
 *
 * Integration tests for /api/auth/* over a real Express app bound to an
 * ephemeral port: guest token issuing, register/login flows (including
 * duplicate usernames and the shared bad-credentials response), and the
 * Bearer/x-player-id resolution on the protected /api/rooms endpoints.
 * Run with: node --import tsx --test backend/routes/auth.test.ts
 */

const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const express = require('express');
const authRoutes = require('./auth');
const roomRoutes = require('./rooms');
const authService = require('../services/auth-service');
const store = require('../storage/memory-store');

let server: any = null;
let baseUrl = '';

function resetStore() {
  store.players.clear();
  store.rooms.clear();
  store.games.clear();
  store.sockets.clear();
  store.playerSockets.clear();
}

async function post(path: string, body: any, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/rooms', roomRoutes);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test.beforeEach(() => {
  resetStore();
});

// ─── Guest ───────────────────────────────────────────────────────

test('POST /api/auth/guest returns the legacy player shape plus a guest token', async () => {
  const { status, body } = await post('/api/auth/guest', {});

  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(body.player.id);
  assert.ok(body.player.nickname);
  assert.deepEqual(Object.keys(body.player).sort(), ['avatar', 'chips', 'id', 'nickname']);

  const payload = authService.verifyToken(body.token);
  assert.deepEqual(payload, { playerId: body.player.id, type: 'guest' });
});

// ─── Register ────────────────────────────────────────────────────

test('POST /api/auth/register creates the account and returns a user token', async () => {
  const { status, body } = await post('/api/auth/register', { username: 'alice_1', password: 'hunter22' });

  assert.equal(status, 201);
  assert.equal(body.success, true);
  assert.equal(body.player.nickname, 'alice_1');
  assert.equal(body.player.passwordHash, undefined);

  const payload = authService.verifyToken(body.token);
  assert.deepEqual(payload, { playerId: body.player.id, type: 'user' });

  const stored = await store.getPlayer(body.player.id);
  assert.equal(stored.username, 'alice_1');
  assert.equal(stored.isGuest, false);
  assert.ok(stored.passwordHash);
});

test('POST /api/auth/register rejects a duplicate username (case-insensitive)', async () => {
  await post('/api/auth/register', { username: 'Alice', password: 'hunter22' });
  const { status, body } = await post('/api/auth/register', { username: 'alice', password: 'other-pass' });

  assert.equal(status, 409);
  assert.equal(body.success, false);
  assert.equal(body.error, 'Username already taken');
});

test('POST /api/auth/register validates username and password shape', async () => {
  const badName = await post('/api/auth/register', { username: 'a!', password: 'hunter22' });
  assert.equal(badName.status, 400);

  const shortPw = await post('/api/auth/register', { username: 'valid_name', password: '123' });
  assert.equal(shortPw.status, 400);
});

// ─── Login ───────────────────────────────────────────────────────

test('POST /api/auth/login succeeds with correct credentials', async () => {
  await post('/api/auth/register', { username: 'bob', password: 'hunter22' });
  const { status, body } = await post('/api/auth/login', { username: 'bob', password: 'hunter22' });

  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.player.nickname, 'bob');

  const payload = authService.verifyToken(body.token);
  assert.equal(payload.type, 'user');
  assert.ok(payload.playerId);
});

test('POST /api/auth/login rejects a wrong password with the generic error', async () => {
  await post('/api/auth/register', { username: 'carol', password: 'hunter22' });
  const { status, body } = await post('/api/auth/login', { username: 'carol', password: 'wrong-pass' });

  assert.equal(status, 401);
  assert.equal(body.error, 'Invalid username or password');
});

test('POST /api/auth/login rejects an unknown username with the same generic error', async () => {
  const { status, body } = await post('/api/auth/login', { username: 'ghost', password: 'hunter22' });

  assert.equal(status, 401);
  assert.equal(body.error, 'Invalid username or password');
});

// ─── Bearer vs x-player-id on protected routes ───────────────────

test('POST /api/rooms accepts a Bearer token instead of x-player-id', async () => {
  const guest = await post('/api/auth/guest', {});
  const { status, body } = await post('/api/rooms', { name: 'Token Room', maxPlayers: 4 }, {
    authorization: `Bearer ${guest.body.token}`,
  });

  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.room.hostId, guest.body.player.id);
});

test('POST /api/rooms still accepts the legacy x-player-id header', async () => {
  const guest = await post('/api/auth/guest', {});
  const { status, body } = await post('/api/rooms', { name: 'Legacy Room' }, {
    'x-player-id': guest.body.player.id,
  });

  assert.equal(status, 200);
  assert.equal(body.success, true);
});

test('POST /api/rooms rejects an invalid Bearer token even with a valid header', async () => {
  const guest = await post('/api/auth/guest', {});
  const { status, body } = await post('/api/rooms', { name: 'Nope' }, {
    authorization: 'Bearer forged-token',
    'x-player-id': guest.body.player.id,
  });

  assert.equal(status, 401);
  assert.equal(body.error, 'Invalid or expired token');
});

test('POST /api/rooms rejects requests without any identity', async () => {
  const { status, body } = await post('/api/rooms', { name: 'Nope' });

  assert.equal(status, 401);
  assert.equal(body.error, 'Player ID required');
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
