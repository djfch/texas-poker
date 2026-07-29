/**
 * backend/storage/redis-room-flow.test.ts - Redis-backed room/game flows
 *
 * P5c write-through proof: with the store singleton swapped for a
 * RedisStore over an in-process fake Redis (no Docker on this machine),
 * the full lobby chain (join → sit → ready → borrow) and a complete hand
 * (startGame → action → showdown) must survive JSON round-trips — every
 * read below returns a fresh deserialized copy, so assertions only pass
 * when each mutation was actually written back.
 *
 * A real-Redis variant runs only when REDIS_URL is set (CI); otherwise it
 * is explicitly skipped.
 */

const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const { RedisStore } = require('./redis-store');

// ─── Fake Redis (same command surface as redis-store.test.ts) ────

class FakeRedis {
  data = new Map<string, string>();

  async set(...args: any[]) {
    this.data.set(args[0], String(args[1]));
    return 'OK';
  }

  async get(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  async del(...keys: string[]) {
    let removed = 0;
    for (const key of keys) if (this.data.delete(key)) removed++;
    return removed;
  }

  async scan(cursor: string, ...args: any[]) {
    const pattern = String(args[1]);
    const prefix = pattern.replace('*', '');
    const keys = [...this.data.keys()].filter(k => k.startsWith(prefix));
    return ['0', keys] as [string, string[]];
  }

  on(_event: string, _listener: (...args: any[]) => void) {
    return this;
  }
}

// ─── Swap the store singleton for a RedisStore before the services
// bind it. room-manager/game-engine capture the store at require time,
// so the cache entry is replaced first; the real memory singleton is
// restored after the file finishes (each test file is its own process).
const memoryStorePath = require.resolve('../storage/memory-store');
const realMemoryStore = require('../storage/memory-store');
const fake = new FakeRedis();
const store = new RedisStore({ client: fake });
require.cache[memoryStorePath]!.exports = store;

const roomManager = require('../services/room-manager');
const gameEngine = require('../services/game-engine');
const aiManager = require('../services/ai-manager');

test.after(() => {
  require.cache[memoryStorePath]!.exports = realMemoryStore;
  delete require.cache[require.resolve('../services/room-manager')];
  delete require.cache[require.resolve('../services/game-engine')];
  delete require.cache[require.resolve('../services/ai-manager')];
  delete require.cache[require.resolve('../services/player-manager')];
});

// Tests share one fake Redis; wipe all keys between them.
test.afterEach(() => {
  fake.data.clear();
});

// ─── Fixtures ────────────────────────────────────────────────────

async function createPlayer(id: string) {
  await store.createPlayer({
    id,
    nickname: id,
    avatar: '#2ecc71',
    chips: 1000,
    isAI: false,
    isGuest: true,
    isOnline: true,
    currentRoom: null,
  });
}

function createRoomFixture(overrides: Record<string, any> = {}) {
  return {
    id: 'ROOM01',
    name: 'Redis Room',
    hostId: 'human-1',
    maxPlayers: 6,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: false,
    isPrivate: false,
    status: 'waiting',
    players: [
      { playerId: 'human-1', nickname: 'human-1', avatar: '#111', seatPosition: -1, isReady: false, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
    seats: [null, null, null, null, null, null, null, null, null],
    chatHistory: [],
    currentGameId: null,
    dealerPosition: null,
    awaitingNextHandReady: false,
    createdAt: Date.now(),
    gameStartedAt: null,
    ...overrides,
  };
}

// ─── Lobby chain ─────────────────────────────────────────────────

test('redis: join → sit → ready chain persists across fresh reads', async () => {
  await createPlayer('human-1');
  await createPlayer('human-2');
  await store.createRoom(createRoomFixture({ players: [] }));

  assert.equal((await roomManager.joinRoom('ROOM01', 'human-1')).success, true);
  assert.equal((await roomManager.joinRoom('ROOM01', 'human-2')).success, true);
  assert.equal((await roomManager.sit('ROOM01', 'human-1', 0)).success, true);
  assert.equal((await roomManager.sit('ROOM01', 'human-2', 1)).success, true);
  assert.equal((await roomManager.ready('ROOM01', 'human-1', true)).success, true);
  assert.equal((await roomManager.ready('ROOM01', 'human-2', true)).success, true);

  // Every store read is a fresh JSON copy: these assertions only pass if
  // each step actually wrote through.
  const room = await store.getRoom('ROOM01');
  assert.equal(room.players.length, 2);
  assert.equal(room.seats[0], 'human-1');
  assert.equal(room.seats[1], 'human-2');
  assert.equal(room.hostId, 'human-1');
  for (const id of ['human-1', 'human-2']) {
    const rp = room.players.find((p: any) => p.playerId === id);
    assert.equal(rp.isReady, true, `${id} room ready flag must persist`);
    assert.equal(rp.chips, 1000, `${id} room chips must persist`);
    assert.equal(rp.buyInTotal, 1000, `${id} buy-in ledger must persist`);

    const sp = await store.getPlayer(id);
    assert.equal(sp.currentRoom, 'ROOM01', `${id} player-room link must persist`);
    assert.equal(sp.isReady, true, `${id} player ready flag must persist`);
    assert.equal(sp.chips, 1000, `${id} player chips must persist`);
  }
  assert.equal((await store.getPlayer('human-1')).seatPosition, 0);
  assert.equal((await store.getPlayer('human-2')).seatPosition, 1);
});

test('redis: borrowChips persists the ledger across fresh reads', async () => {
  await createPlayer('human-1');
  await store.createRoom(createRoomFixture({
    players: [
      { playerId: 'human-1', nickname: 'human-1', avatar: '#111', seatPosition: 0, isReady: false, chips: 0, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
    seats: ['human-1', null, null, null, null, null, null, null, null],
  }));

  const result = await roomManager.borrowChips('ROOM01', 'human-1');
  assert.equal(result.success, true);

  const room = await store.getRoom('ROOM01');
  const rp = room.players.find((p: any) => p.playerId === 'human-1');
  assert.equal(rp.chips, 1000);
  assert.equal(rp.buyInTotal, 2000);
  assert.equal(rp.borrowCount, 1);
  assert.equal(rp.isReady, false);

  const sp = await store.getPlayer('human-1');
  assert.equal(sp.chips, 1000);
  assert.equal(sp.isReady, false);
});

test('redis: leaveRoom persists the shrunken room and clears the player', async () => {
  await createPlayer('human-1');
  await createPlayer('human-2');
  await store.createRoom(createRoomFixture({
    players: [
      { playerId: 'human-1', nickname: 'human-1', avatar: '#111', seatPosition: 0, isReady: false, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
      { playerId: 'human-2', nickname: 'human-2', avatar: '#222', seatPosition: 1, isReady: false, chips: 500, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
    seats: ['human-1', 'human-2', null, null, null, null, null, null, null],
  }));

  const result = await roomManager.leaveRoom('ROOM01', 'human-2');
  assert.equal(result.success, true);
  assert.equal(result.settlement.chips, 500);

  const room = await store.getRoom('ROOM01');
  assert.equal(room.players.length, 1);
  assert.equal(room.seats[1], null);
  assert.equal(room.hostId, 'human-1');

  const sp = await store.getPlayer('human-2');
  assert.equal(sp.currentRoom, null);
  assert.equal(sp.seatPosition, -1);
  assert.equal(sp.chips, 0);
});

// ─── Full hand ───────────────────────────────────────────────────

test('redis: fillRoomWithAI seats one bot per empty seat, not one total', async () => {
  await createPlayer('human-1');
  await store.createRoom(createRoomFixture({
    allowAI: true,
    maxPlayers: 4,
    players: [
      { playerId: 'human-1', nickname: 'human-1', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
    seats: ['human-1', null, null, null, null, null, null, null, null],
  }));

  // Each createBot() persists a new seat; the loop must observe fresh
  // snapshots (copy-returning store) instead of reusing the first read,
  // otherwise it would target the same seat every round and add 1 bot.
  const bots = await aiManager.fillRoomWithAI('ROOM01');
  assert.equal(bots.length, 3);

  const room = await store.getRoom('ROOM01');
  assert.equal(room.players.length, 4);
  const seated = room.seats.filter(Boolean);
  assert.equal(seated.length, 4);
  assert.equal(new Set(seated).size, 4, 'each bot must land on a distinct seat');
});

test('redis: a complete hand plays end-to-end and the settlement persists', async () => {
  await createPlayer('human-1');
  await createPlayer('human-2');

  const room = await roomManager.createRoom('human-1', {
    name: 'Redis Hand',
    maxPlayers: 2,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: false,
  });
  const roomId = room.id;

  assert.equal((await roomManager.joinRoom(roomId, 'human-2')).success, true);
  assert.equal((await roomManager.sit(roomId, 'human-1', 0)).success, true);
  assert.equal((await roomManager.sit(roomId, 'human-2', 1)).success, true);
  assert.equal((await roomManager.ready(roomId, 'human-1', true)).success, true);
  assert.equal((await roomManager.ready(roomId, 'human-2', true)).success, true);
  assert.equal(await roomManager.canStart(roomId), true);

  assert.equal((await roomManager.startGame(roomId, 'human-1')).success, true);
  assert.equal((await gameEngine.startGame(roomId)).success, true);

  // The dealt game survives the round-trip with live domain objects.
  const started = await store.getGame(roomId);
  assert.equal(started.status, 'preflop');
  assert.equal(typeof started.pots.getTotalPot, 'function', 'PotManager must be revived');
  assert.equal(started.pots.getTotalPot(), 30);
  assert.equal(typeof started.deck.deal, 'function', 'Deck must be revived');
  assert.equal((await store.getRoom(roomId)).status, 'playing');

  // Heads-up: seat 0 is dealer/small blind and acts first preflop.
  const state = await gameEngine.getGameState(roomId, null);
  const folderId = state.currentPlayerId;
  const winnerId = folderId === 'human-1' ? 'human-2' : 'human-1';

  const result = await gameEngine.handleAction(roomId, folderId, 'fold');
  assert.equal(result.success, true);
  assert.equal(result.game.status, 'ended');

  // Game entity persisted through the showdown.
  const ended = await store.getGame(roomId);
  assert.equal(ended.status, 'ended');
  assert.equal(ended.winners.length, 1);
  assert.equal(ended.winners[0].playerId, winnerId);
  assert.equal(ended.handResults.length, 2);

  // Room lifecycle + nested players[] chips persisted (the P5c gap).
  const settled = await store.getRoom(roomId);
  assert.equal(settled.status, 'waiting');
  assert.equal(settled.currentGameId, null);
  assert.equal(settled.awaitingNextHandReady, true);
  assert.equal(settled.dealerPosition, 0);
  const rpFolder = settled.players.find((p: any) => p.playerId === folderId);
  const rpWinner = settled.players.find((p: any) => p.playerId === winnerId);
  const blind = folderId === 'human-1' ? 10 : 20; // folder posted SB or BB
  assert.equal(rpFolder.chips, 1000 - blind);
  assert.equal(rpWinner.chips, 1000 + blind);

  // Player records persisted too.
  assert.equal((await store.getPlayer(folderId)).chips, 1000 - blind);
  assert.equal((await store.getPlayer(winnerId)).chips, 1000 + blind);
  assert.equal((await store.getPlayer(folderId)).isReady, false);
});

// ─── Real Redis (CI only) ────────────────────────────────────────

if (process.env.REDIS_URL) {
  test('redis(real): lobby chain persists against a live server', async () => {
    const liveStore = new RedisStore({ url: process.env.REDIS_URL });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const p1 = `e2e-p1-${suffix}`;
    const p2 = `e2e-p2-${suffix}`;
    const previous = require.cache[memoryStorePath]!.exports;
    require.cache[memoryStorePath]!.exports = liveStore;
    delete require.cache[require.resolve('../services/room-manager')];
    const liveRoomManager = require('../services/room-manager');
    let roomId: string | null = null;
    try {
      await liveStore.createPlayer({ id: p1, nickname: p1, chips: 0, currentRoom: null });
      await liveStore.createPlayer({ id: p2, nickname: p2, chips: 0, currentRoom: null });

      // createRoom auto-joins the host; sit/ready complete the chain.
      const room = await liveRoomManager.createRoom(p1, { maxPlayers: 4, allowAI: false });
      roomId = room.id;
      assert.equal((await liveRoomManager.joinRoom(roomId, p2)).success, true);
      assert.equal((await liveRoomManager.sit(roomId, p1, 0)).success, true);
      assert.equal((await liveRoomManager.sit(roomId, p2, 1)).success, true);
      assert.equal((await liveRoomManager.ready(roomId, p1, true)).success, true);

      const reloaded = await liveStore.getRoom(roomId);
      assert.equal(reloaded.players.length, 2);
      assert.equal(reloaded.seats[0], p1);
      assert.equal(reloaded.seats[1], p2);
      assert.equal(reloaded.players.find((p: any) => p.playerId === p1).isReady, true);
      assert.equal((await liveStore.getPlayer(p1)).seatPosition, 0);
    } finally {
      require.cache[memoryStorePath]!.exports = previous;
      delete require.cache[require.resolve('../services/room-manager')];
      if (roomId) await liveStore.deleteRoom(roomId);
      await liveStore.deletePlayer(p1);
      await liveStore.deletePlayer(p2);
      await liveStore.close();
    }
  });
} else {
  test('redis(real): room flow', { skip: 'REDIS_URL not set' }, () => {});
}

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
