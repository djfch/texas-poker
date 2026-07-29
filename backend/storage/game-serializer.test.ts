/**
 * backend/storage/game-serializer.test.ts - Domain-aware game serialization tests
 *
 * Covers the P4 gap fixed in P5a: a live game (Deck, PotManager, Card
 * instances, actionsTaken Set) must survive a Redis JSON round-trip with
 * field-level equivalence, and the engine must be able to keep playing a
 * revived game all the way to the next street.
 *
 * The Redis server is faked in-process (no Docker on this machine); the
 * payload assertions verify the exact JSON that would cross the wire.
 */

const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const { Card } = require('../domain/card');
const { Deck } = require('../domain/deck');
const { PotManager } = require('../domain/pot-manager');
const { serializeGame, deserializeGame } = require('./game-serializer');
const { RedisStore, REDIS_KEYS } = require('./redis-store');
const gameEngine = require('../services/game-engine');
const store = require('../storage/memory-store');

/** Same in-memory Redis fake convention as redis-store.test.ts. */
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
    const prefix = String(args[1]).replace('*', '');
    const keys = [...this.data.keys()].filter(k => k.startsWith(prefix));
    return ['0', keys] as [string, string[]];
  }

  on(_event: string, _listener: (...args: any[]) => void) {
    return this;
  }
}

function resetStore() {
  store.players.clear();
  store.rooms.clear();
  store.games.clear();
  store.sockets.clear();
  store.playerSockets.clear();
}

test.afterEach(() => {
  resetStore();
});

async function createPlayer(id: string, seatPosition: number) {
  await store.createPlayer({
    id,
    nickname: id,
    avatar: '#2ecc71',
    chips: 1000,
    isAI: false,
    isGuest: true,
    isOnline: true,
    currentRoom: 'ROOM01',
    seatPosition,
  });
}

/** Build a real mid-hand game: 3 seats, preflop completed, flop dealt. */
async function buildFlopGame() {
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await createPlayer('human-3', 2);
  await store.createRoom({
    id: 'ROOM01',
    name: 'Serializer Room',
    hostId: 'human-1',
    maxPlayers: 3,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: false,
    isPrivate: false,
    status: 'playing',
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-3', nickname: 'Human Three', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
    ],
    seats: ['human-1', 'human-2', 'human-3', null, null, null, null, null, null],
    chatHistory: [],
    currentGameId: null,
    dealerPosition: null,
    createdAt: Date.now(),
    gameStartedAt: Date.now(),
  });

  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  // Preflop: seat order 0 (UTG) -> 1 (SB) -> 2 (BB); call/call/check closes it.
  assert.equal((await gameEngine.handleAction('ROOM01', 'human-1', 'call')).success, true);
  assert.equal((await gameEngine.handleAction('ROOM01', 'human-2', 'call')).success, true);
  const preflopEnd = await gameEngine.handleAction('ROOM01', 'human-3', 'check');
  assert.equal(preflopEnd.success, true);
  assert.equal(preflopEnd.game.status, 'flop');

  const live = await store.getGame('ROOM01');
  assert.ok(live, 'live game must exist in the memory store');
  return live;
}

test('Deck toJSON/fromJSON preserves remaining card order and behaviour', () => {
  const deck = Deck.createShuffled();
  const dealt = deck.deal(5).map((c: any) => c.toString());

  const revived = Deck.fromJSON(JSON.parse(JSON.stringify(deck.toJSON())));
  assert.ok(revived instanceof Deck);
  assert.deepEqual(revived.cards.map((c: any) => c.toString()), deck.cards.map((c: any) => c.toString()));
  assert.equal(revived.remaining(), 47);
  assert.ok(revived.cards[0] instanceof Card);

  // The revived deck deals the same next card the original would.
  assert.equal(revived.deal(1)[0].toString(), deck.cards[0].toString());
  assert.equal(dealt.length, 5, 'dealt cards stay out of the snapshot');

  // shuffle() still works on a revived deck (RNG restored).
  revived.shuffle();
  assert.equal(revived.remaining(), 46);

  assert.throws(() => Deck.fromJSON({}), /Invalid deck JSON/);
  assert.throws(() => Deck.fromJSON(null), /Invalid deck JSON/);
});

test('PotManager toJSON/fromJSON preserves bets, statuses and pot math', () => {
  const pm = new PotManager([
    { position: 0, totalBet: 50, status: 'allin', chips: 0 },
    { position: 1, totalBet: 100, status: 'active', chips: 900 },
    { position: 2, totalBet: 100, status: 'folded', chips: 900 },
  ]);

  const revived = PotManager.fromJSON(JSON.parse(JSON.stringify(pm.toJSON())));
  assert.ok(revived instanceof PotManager);
  for (const position of [0, 1, 2]) {
    assert.deepEqual(revived.getBet(position), pm.getBet(position));
  }
  assert.deepEqual(revived.calculatePots(), pm.calculatePots());
  assert.equal(revived.getTotalPot(), 250);

  // Behaviour survives: addBet/setStatus mutate the revived instance.
  revived.addBet(1, 40);
  assert.equal(revived.getBet(1).totalBet, 140);
  revived.setStatus(1, 'allin');
  assert.equal(revived.getBet(1).status, 'allin');

  assert.throws(() => PotManager.fromJSON({}), /Invalid pot-manager JSON/);
});

test('serializeGame/deserializeGame leaves plain fixture games byte-identical', () => {
  const plain = { roomId: 'r-plain', status: 'preflop', pot: 100 };
  const roundTripped = deserializeGame(JSON.parse(JSON.stringify(serializeGame(plain))));
  assert.deepEqual(roundTripped, plain);
  assert.equal('actionsTaken' in roundTripped, false, 'no fields are added to plain games');
});

test('mid-hand game survives a Redis round-trip with field-level equivalence', async () => {
  const live = await buildFlopGame();
  const fake = new FakeRedis();
  const redis = new RedisStore({ client: fake });

  await redis.createGame(live);

  // The wire payload holds plain data for every non-plain field.
  const wire = JSON.parse(fake.data.get(REDIS_KEYS.game('ROOM01'))!);
  assert.ok(Array.isArray(wire.deck.cards), 'deck snapshot is a card array');
  assert.ok(Array.isArray(wire.actionsTaken), 'actionsTaken is stored as an array');
  assert.ok(Array.isArray(wire.pots.bets), 'pot snapshot is a bet array');
  assert.deepEqual(wire.deck.cards[0], live.deck.cards[0].toJSON());

  const revived = await redis.getGame('ROOM01');

  // Domain types revived.
  assert.ok(revived.deck instanceof Deck, 'deck must be a Deck');
  assert.ok(revived.pots instanceof PotManager, 'pots must be a PotManager');
  assert.ok(revived.actionsTaken instanceof Set, 'actionsTaken must be a Set');
  assert.ok(revived.communityCards[0] instanceof Card, 'community cards must be Cards');
  assert.ok(revived.players[0].holeCards[0] instanceof Card, 'hole cards must be Cards');

  // Field-level equivalence with the live mid-hand game.
  assert.deepEqual(
    revived.deck.cards.map((c: any) => c.toString()),
    live.deck.cards.map((c: any) => c.toString()),
    'remaining deck order is preserved'
  );
  assert.equal(revived.deck.remaining(), 43, '52 - 6 hole cards - 3 flop cards');
  for (const position of [0, 1, 2]) {
    assert.deepEqual(revived.pots.getBet(position), live.pots.getBet(position));
  }
  assert.deepEqual(revived.pots.calculatePots(), live.pots.calculatePots());
  assert.deepEqual([...revived.actionsTaken].sort(), [...live.actionsTaken].sort());
  assert.deepEqual(
    revived.communityCards.map((c: any) => c.toString()),
    live.communityCards.map((c: any) => c.toString())
  );
  for (let i = 0; i < live.players.length; i++) {
    assert.deepEqual(
      revived.players[i].holeCards.map((c: any) => c.toString()),
      live.players[i].holeCards.map((c: any) => c.toString())
    );
    assert.equal(revived.players[i].chips, live.players[i].chips);
    assert.equal(revived.players[i].bet, live.players[i].bet);
  }
  assert.equal(revived.status, 'flop');
  assert.equal(revived.currentPosition, live.currentPosition);
  assert.equal(revived.currentBet, live.currentBet);
  assert.equal(revived.minRaise, live.minRaise);
  assert.equal(revived.dealerPosition, live.dealerPosition);
  assert.equal(revived.smallBlindPos, live.smallBlindPos);
  assert.equal(revived.bigBlindPos, live.bigBlindPos);
  assert.deepEqual(revived.actionHistory, live.actionHistory);

  // A second write (updateGame with the full revived object) round-trips too.
  const saved = await redis.updateGame('ROOM01', revived);
  assert.ok(saved.pots instanceof PotManager, 'updateGame keeps revived types');
  const again = await redis.getGame('ROOM01');
  assert.deepEqual(
    again.deck.cards.map((c: any) => c.toString()),
    live.deck.cards.map((c: any) => c.toString())
  );
});

test('game engine keeps playing a deserialized game through street advancement', async () => {
  const live = await buildFlopGame();
  const fake = new FakeRedis();
  const redis = new RedisStore({ client: fake });
  await redis.createGame(live);
  const revived = await redis.getGame('ROOM01');

  // The turn card the revived deck must deal next.
  const expectedTurnCard = revived.deck.cards[0].toString();

  // Swap the revived (detached) game into the runtime store: the engine
  // now operates purely on the deserialized object.
  store.games.set('ROOM01', revived);

  // Flop round: first to act is the small blind (seat 1); check around.
  const order = ['human-2', 'human-3', 'human-1'];
  for (const playerId of order) {
    const state = await gameEngine.getGameState('ROOM01', null);
    assert.equal(state.currentPlayerId, playerId, `turn must belong to ${playerId}`);
    const result = await gameEngine.handleAction('ROOM01', playerId, 'check');
    assert.equal(result.success, true, `${playerId} check must succeed on the revived game`);
  }

  const advanced = await gameEngine.getGameState('ROOM01', null);
  assert.equal(advanced.status, 'turn', 'the street must advance on the revived game');
  assert.equal(advanced.communityCards.length, 4);
  assert.equal(
    advanced.communityCards[3],
    expectedTurnCard,
    'the turn card must come from the top of the revived deck (order preserved)'
  );
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
