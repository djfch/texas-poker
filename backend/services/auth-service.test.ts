/**
 * backend/services/auth-service.test.ts
 *
 * Unit tests for JWT signing/verification, bcrypt password hashing, and
 * the unified request-identity resolution (Bearer > x-player-id).
 * Run with: node --import tsx --test backend/services/auth-service.test.ts
 */

const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const authService = require('./auth-service');

// ─── JWT sign / verify ───────────────────────────────────────────

test('signToken + verifyToken round-trips a guest payload', () => {
  const token = authService.signToken('player-1', 'guest');
  assert.deepEqual(authService.verifyToken(token), { playerId: 'player-1', type: 'guest' });
});

test('signToken + verifyToken round-trips a user payload', () => {
  const token = authService.signToken('user-9', 'user');
  assert.deepEqual(authService.verifyToken(token), { playerId: 'user-9', type: 'user' });
});

test('verifyToken rejects a token signed with a different secret', () => {
  const jwt = require('jsonwebtoken');
  const forged = jwt.sign({ playerId: 'player-1', type: 'user' }, 'attacker-secret');
  assert.equal(authService.verifyToken(forged), null);
});

test('verifyToken rejects an expired token', () => {
  const expired = authService.signToken('player-1', 'guest', '-10s');
  assert.equal(authService.verifyToken(expired), null);
});

test('verifyToken rejects garbage and non-string input', () => {
  assert.equal(authService.verifyToken('not-a-jwt'), null);
  assert.equal(authService.verifyToken(''), null);
  assert.equal(authService.verifyToken(null), null);
  assert.equal(authService.verifyToken(undefined), null);
  assert.equal(authService.verifyToken(42), null);
});

test('verifyToken rejects tokens with an unexpected payload type', () => {
  // signToken signs whatever it is given at runtime; verify must filter.
  const token = authService.signToken('player-1', 'admin');
  assert.equal(authService.verifyToken(token), null);
});

// ─── bcrypt password hashing ─────────────────────────────────────

test('hashPassword + verifyPassword round-trip', async () => {
  const hash = await authService.hashPassword('s3cret!');
  assert.notEqual(hash, 's3cret!');
  assert.equal(await authService.verifyPassword('s3cret!', hash), true);
  assert.equal(await authService.verifyPassword('wrong', hash), false);
});

test('dummyPasswordHash is a real bcrypt hash usable for timing-safe compares', async () => {
  const dummy = await authService.dummyPasswordHash();
  assert.match(dummy, /^\$2[aby]\$/);
  assert.equal(await authService.verifyPassword('anything', dummy), false);
  // Memoized: same hash instance across calls.
  assert.equal(await authService.dummyPasswordHash(), dummy);
});

// ─── Request identity resolution ─────────────────────────────────

function reqWith(headers: Record<string, string>) {
  return { headers };
}

test('resolveRequestIdentity prefers a valid Bearer token', () => {
  const token = authService.signToken('token-user', 'user');
  const resolved = authService.resolveRequestIdentity(
    reqWith({ authorization: `Bearer ${token}`, 'x-player-id': 'legacy-user' })
  );
  assert.deepEqual(resolved, { playerId: 'token-user' });
});

test('resolveRequestIdentity falls back to the legacy x-player-id header', () => {
  const resolved = authService.resolveRequestIdentity(reqWith({ 'x-player-id': 'legacy-user' }));
  assert.deepEqual(resolved, { playerId: 'legacy-user' });
});

test('resolveRequestIdentity reports an error for an invalid Bearer token', () => {
  const resolved = authService.resolveRequestIdentity(
    reqWith({ authorization: 'Bearer garbage', 'x-player-id': 'legacy-user' })
  );
  assert.equal(resolved.playerId, null);
  assert.equal(resolved.error, 'Invalid or expired token');
});

test('resolveRequestIdentity returns null playerId when no identity is present', () => {
  const resolved = authService.resolveRequestIdentity(reqWith({}));
  assert.equal(resolved.playerId, null);
  assert.equal(resolved.error, undefined);
});

// ─── Public player shape ─────────────────────────────────────────

test('toPublicPlayer strips credentials from a player record', () => {
  const publicPlayer = authService.toPublicPlayer({
    id: 'u-1',
    username: 'alice',
    passwordHash: '$2b$10$abcdef',
    nickname: 'alice',
    avatar: '#fff',
    chips: 1000,
  });
  assert.deepEqual(publicPlayer, { id: 'u-1', nickname: 'alice', avatar: '#fff', chips: 1000 });
  assert.equal('passwordHash' in publicPlayer, false);
  assert.equal('username' in publicPlayer, false);
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
