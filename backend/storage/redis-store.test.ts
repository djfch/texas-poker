/**
 * backend/storage/redis-store.test.ts - RedisStore unit tests
 *
 * Pure-logic tests against a fake in-memory Redis client (no real server):
 * key conventions, JSON payloads, TTL arguments and memory-store semantics.
 */

const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const { RedisStore, REDIS_KEYS, REDIS_TTL_MS } = require('./redis-store');

/** Minimal RedisLike fake recording every command. */
class FakeRedis {
  data = new Map<string, string>();
  calls: any[][] = [];
  errors: Error[] = [];

  async set(...args: any[]) {
    this.calls.push(['set', ...args]);
    this.data.set(args[0], String(args[1]));
    return 'OK';
  }

  async get(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  async del(...keys: string[]) {
    this.calls.push(['del', ...keys]);
    let removed = 0;
    for (const key of keys) if (this.data.delete(key)) removed++;
    return removed;
  }

  async scan(cursor: string, ...args: any[]) {
    this.calls.push(['scan', cursor, ...args]);
    const pattern = String(args[1]);
    const prefix = pattern.replace('*', '');
    const keys = [...this.data.keys()].filter(k => k.startsWith(prefix));
    return ['0', keys] as [string, string[]];
  }

  on(_event: string, _listener: (...args: any[]) => void) {
    return this;
  }
}

function makeStore() {
  const fake = new FakeRedis();
  const store = new RedisStore({ client: fake });
  return { store, fake };
}

/** Find the TTL (ms) passed as the PX argument of the last SET for a key. */
function ttlOfSet(fake: FakeRedis, key: string): number | null {
  for (let i = fake.calls.length - 1; i >= 0; i--) {
    const call = fake.calls[i];
    if (call[0] === 'set' && call[1] === key) {
      assert.equal(call[3], 'PX');
      return call[4];
    }
  }
  return null;
}

test('player records are stored as JSON under poker:player:{id} with 7d TTL', async () => {
  const { store, fake } = makeStore();
  const player = { id: 'p1', nickname: 'Redis Player', chips: 500, currentRoom: null };
  await store.createPlayer(player);

  const key = REDIS_KEYS.player('p1');
  assert.equal(key, 'poker:player:p1');
  assert.deepEqual(JSON.parse(fake.data.get(key)!), player);
  assert.equal(ttlOfSet(fake, key), REDIS_TTL_MS.player);
  assert.equal(REDIS_TTL_MS.player, 7 * 24 * 3600 * 1000);

  assert.deepEqual(await store.getPlayer('p1'), player);
  assert.equal(await store.getPlayer('missing'), null);
  await assert.rejects(() => store.createPlayer(player), /Player already exists: p1/);
});

test('updatePlayer merges fields and refreshes the player TTL', async () => {
  const { store, fake } = makeStore();
  await store.createPlayer({ id: 'p1', nickname: 'Old', chips: 100 });

  const updated = await store.updatePlayer('p1', { chips: 250 });
  assert.equal(updated.chips, 250);
  assert.equal(updated.nickname, 'Old');
  assert.equal((await store.getPlayer('p1')).chips, 250);
  assert.equal(ttlOfSet(fake, REDIS_KEYS.player('p1')), REDIS_TTL_MS.player);

  assert.equal(await store.updatePlayer('missing', { chips: 1 }), null);
});

test('socket links write both key families with TTL and sync the player record', async () => {
  const { store, fake } = makeStore();
  await store.createPlayer({ id: 'p1', socketId: null, isOnline: false });

  await store.linkSocket('s1', 'p1');
  assert.equal(fake.data.get(REDIS_KEYS.socket('s1')), 'p1');
  assert.equal(fake.data.get(REDIS_KEYS.socketByPlayer('p1')), 's1');
  assert.equal(ttlOfSet(fake, REDIS_KEYS.socket('s1')), REDIS_TTL_MS.socket);
  assert.equal(ttlOfSet(fake, REDIS_KEYS.socketByPlayer('p1')), REDIS_TTL_MS.socket);
  assert.equal(REDIS_KEYS.socket('s1'), 'poker:socket:s1');
  assert.equal(REDIS_KEYS.socketByPlayer('p1'), 'poker:socket_by_player:p1');

  const player = await store.getPlayer('p1');
  assert.equal(player.socketId, 's1');
  assert.equal(player.isOnline, true);

  // Re-link deletes the stale forward key
  await store.linkSocket('s2', 'p1');
  assert.equal(fake.data.has(REDIS_KEYS.socket('s1')), false);
  assert.equal(await store.getSocketByPlayerId('p1'), 's2');

  await store.unlinkSocket('s2');
  assert.equal(await store.getPlayerIdBySocket('s2'), null);
  assert.equal(await store.getSocketByPlayerId('p1'), null);
  const offline = await store.getPlayer('p1');
  assert.equal(offline.socketId, null);
  assert.equal(offline.isOnline, false);
});

test('deletePlayer removes the player key and its socket links', async () => {
  const { store, fake } = makeStore();
  await store.createPlayer({ id: 'p1' });
  await store.linkSocket('s1', 'p1');

  await store.deletePlayer('p1');
  assert.equal(fake.data.has(REDIS_KEYS.player('p1')), false);
  assert.equal(fake.data.has(REDIS_KEYS.socket('s1')), false);
  assert.equal(fake.data.has(REDIS_KEYS.socketByPlayer('p1')), false);
});

test('rooms and games use their key families with 24h TTL; deleteRoom also drops the game', async () => {
  const { store, fake } = makeStore();
  await store.createRoom({ id: 'r1', status: 'waiting', players: [] });
  assert.equal(REDIS_KEYS.room('r1'), 'poker:room:r1');
  assert.equal(ttlOfSet(fake, REDIS_KEYS.room('r1')), REDIS_TTL_MS.room);
  assert.equal(REDIS_TTL_MS.room, 24 * 3600 * 1000);

  await store.createGame({ roomId: 'r1', status: 'preflop' });
  assert.equal(REDIS_KEYS.game('r1'), 'poker:game:r1');
  assert.equal(ttlOfSet(fake, REDIS_KEYS.game('r1')), REDIS_TTL_MS.game);

  // createGame overwrites without a duplicate error
  await store.createGame({ roomId: 'r1', status: 'flop' });
  assert.equal((await store.getGame('r1')).status, 'flop');

  await store.deleteRoom('r1');
  assert.equal(await store.getRoom('r1'), null);
  assert.equal(await store.getGame('r1'), null);
});

test('listRooms/listPlayers scan only their own key prefixes', async () => {
  const { store, fake } = makeStore();
  await store.createPlayer({ id: 'p1', nickname: 'A' });
  await store.linkSocket('s1', 'p1');
  await store.createRoom({ id: 'r1', status: 'waiting', isPrivate: false, players: [] });

  const players = await store.listPlayers();
  assert.deepEqual(players.map((p: any) => p.id), ['p1']);

  const rooms = await store.listRooms();
  assert.deepEqual(rooms.map((r: any) => r.id), ['r1']);

  const scanPatterns = fake.calls.filter(c => c[0] === 'scan').map(c => c[3]);
  assert.ok(scanPatterns.includes('poker:player:*'));
  assert.ok(scanPatterns.includes('poker:room:*'));
});

test('cleanup removes stale empty rooms and keeps fresh or occupied ones', async () => {
  const { store } = makeStore();
  await store.createRoom({ id: 'stale', players: [], createdAt: Date.now() - 2 * 3600000 });
  await store.createRoom({ id: 'fresh', players: [], createdAt: Date.now() });
  await store.createRoom({ id: 'busy', players: [{ playerId: 'p1' }], createdAt: Date.now() - 2 * 3600000 });

  await store.cleanup();

  assert.equal(await store.getRoom('stale'), null);
  assert.ok(await store.getRoom('fresh'));
  assert.ok(await store.getRoom('busy'));
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
