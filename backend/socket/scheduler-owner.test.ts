/**
 * backend/socket/scheduler-owner.test.ts - Multi-instance scheduler ownership tests
 *
 * Covers the P5a room-level owner semantics with an in-process fake Redis
 * (no Docker on this machine):
 *   1. Lock contention: two instances racing for one room lock — exactly
 *      one becomes owner; the owner can renew, the loser cannot.
 *   2. A non-owner instance processing a turn broadcast arms NO local
 *      turn timer and schedules NO AI decision; it publishes exactly one
 *      turn signal for the owner instead.
 *   3. After the owner's lock expires, a surviving instance takes over at
 *      the next scheduling point and rebuilds the turn timeout (signal
 *      path keeps the signal's deadline; a fresh scheduling point uses
 *      now + full action duration — the documented simplified semantics).
 * Single-instance behaviour (no scheduler wired) is covered by the
 * untouched turn-concurrency regression suite.
 */

const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const {
  SchedulerOwner,
  SCHEDULER_LOCK_KEY,
  SCHEDULER_CHANNEL,
} = require('./scheduler-owner');
const gameEngine = require('../services/game-engine');
const aiManager = require('../services/ai-manager');
const store = require('../storage/memory-store');
const {
  setupSocketHandlers,
  _broadcastGameTurn,
  _cancelTurnTimer,
  _hasTurnTimer,
} = require('./handlers');

// ─── Fake Redis with lock semantics + pub/sub bus ─────────────────

class FakeBus {
  listeners: Array<{ channel: string; fn: (channel: string, message: string) => void }> = [];
  published: Array<{ channel: string; message: string }> = [];

  deliver(channel: string, message: string) {
    this.published.push({ channel, message });
    for (const l of this.listeners.filter(x => x.channel === channel)) {
      l.fn(channel, message);
    }
  }
}

class FakeSubscriber {
  private bus: FakeBus;
  private handlers: Record<string, Array<(...args: any[]) => void>> = {};

  constructor(bus: FakeBus) {
    this.bus = bus;
  }

  async subscribe(channel: string) {
    this.bus.listeners.push({
      channel,
      fn: (ch, msg) => (this.handlers['message'] || []).forEach(f => f(ch, msg)),
    });
    return 1;
  }

  on(event: string, fn: (...args: any[]) => void) {
    (this.handlers[event] = this.handlers[event] || []).push(fn);
    return this;
  }
}

class FakeLockRedis {
  data = new Map<string, string>();
  expires = new Map<string, number>();
  calls: any[][] = [];

  constructor(private bus: FakeBus, private nowFn: () => number) {}

  private isLive(key: string): boolean {
    const exp = this.expires.get(key);
    return this.data.has(key) && (exp === undefined || exp > this.nowFn());
  }

  async set(...args: any[]) {
    this.calls.push(['set', ...args]);
    const [key, value] = args;
    const nx = args.includes('NX');
    const pxIdx = args.indexOf('PX');
    if (nx && this.isLive(key)) return null;
    this.data.set(key, String(value));
    if (pxIdx >= 0) this.expires.set(key, this.nowFn() + Number(args[pxIdx + 1]));
    return 'OK';
  }

  async get(key: string) {
    return this.isLive(key) ? this.data.get(key)! : null;
  }

  async pexpire(key: string, ms: number) {
    if (!this.isLive(key)) return 0;
    this.expires.set(key, this.nowFn() + ms);
    return 1;
  }

  async publish(channel: string, message: string) {
    this.bus.deliver(channel, message);
    return 1;
  }

  // Atomic JS equivalent of SchedulerOwner's CLAIM_SCRIPT (single-step
  // body: no await between the check and the mutation, so no interleaving
  // window exists in the fake either).
  async eval(script: string, _numKeys: number, key: string, value: string, ttlMs: number) {
    this.calls.push(['eval', script, key, value, ttlMs]);
    if (!this.isLive(key)) {
      this.data.set(key, String(value));
      this.expires.set(key, this.nowFn() + Number(ttlMs));
      return 1;
    }
    if (this.data.get(key) === String(value)) {
      this.expires.set(key, this.nowFn() + Number(ttlMs));
      return 1;
    }
    return 0;
  }
}

function makeInstances() {
  const bus = new FakeBus();
  let fakeNow = Date.now();
  const clientA = new FakeLockRedis(bus, () => fakeNow);
  const clientB = new FakeLockRedis(bus, () => fakeNow);
  // Both clients simulate one shared Redis server.
  clientB.data = clientA.data;
  clientB.expires = clientA.expires;

  const subA = new FakeSubscriber(bus);
  const subB = new FakeSubscriber(bus);
  const ownerA = new SchedulerOwner({ client: clientA, subscriber: subA, instanceId: 'instance-A' });
  const ownerB = new SchedulerOwner({ client: clientB, subscriber: subB, instanceId: 'instance-B' });
  return { bus, ownerA, ownerB, advance: (ms: number) => { fakeNow += ms; } };
}

// ─── Game fixture helpers (same conventions as turn-concurrency) ───

function resetStore() {
  store.players.clear();
  store.rooms.clear();
  store.games.clear();
  store.sockets.clear();
  store.playerSockets.clear();
}

function createIoRecorder() {
  const events: any[] = [];
  return {
    events,
    handlers: {} as Record<string, (...args: any[]) => any>,
    on(event: string, callback: (...args: any[]) => any) {
      this.handlers[event] = callback;
    },
    to(target: string) {
      return {
        emit(event: string, payload: any) {
          events.push({ target, event, payload });
        },
      };
    },
  };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createPlayer(id: string, seatPosition: number, isAI = false) {
  await store.createPlayer({
    id,
    nickname: id,
    avatar: '#2ecc71',
    chips: 1000,
    isAI,
    isGuest: true,
    isOnline: true,
    currentRoom: 'ROOM01',
    seatPosition,
  });
}

async function startGameWithBot() {
  await createPlayer('human-1', 0);
  await createPlayer('bot-1', 1, true);
  await createPlayer('human-2', 2);
  await store.createRoom({
    id: 'ROOM01',
    name: 'Scheduler Room',
    hostId: 'human-1',
    maxPlayers: 3,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: true,
    isPrivate: false,
    status: 'playing',
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'bot-1', nickname: 'Bot One', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: true },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
    ],
    seats: ['human-1', 'bot-1', 'human-2', null, null, null, null, null, null],
    chatHistory: [],
    currentGameId: null,
    dealerPosition: null,
    createdAt: Date.now(),
    gameStartedAt: Date.now(),
  });
  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  // Move the turn to the bot at seat 1.
  assert.equal((await gameEngine.handleAction('ROOM01', 'human-1', 'call')).success, true);
}

test.afterEach(() => {
  _cancelTurnTimer('ROOM01');
  // Detach any injected scheduler so later tests start single-instance.
  setupSocketHandlers(createIoRecorder(), {});
  resetStore();
});

// ─── 1. Lock contention ───────────────────────────────────────────

test('two instances racing for one room lock produce exactly one owner', async () => {
  const { ownerA, ownerB } = makeInstances();

  const [aWon, bWon] = await Promise.all([ownerA.claim('ROOM01'), ownerB.claim('ROOM01')]);
  assert.notEqual(aWon, bWon, 'exactly one instance may win the room lock');

  const winner = aWon ? ownerA : ownerB;
  const loser = aWon ? ownerB : ownerA;
  assert.equal(await winner.claim('ROOM01'), true, 'the owner renews its lock');
  assert.equal(await loser.claim('ROOM01'), false, 'the loser stays non-owner');

  assert.equal(
    await winner.client.get(SCHEDULER_LOCK_KEY('ROOM01')),
    winner.instanceId,
    'the lock value identifies the owning instance'
  );
  assert.equal(SCHEDULER_LOCK_KEY('ROOM01'), 'poker:lock:room:ROOM01');
});

test('claim issues one atomic script call (no NX/GET/PEXPIRE race window)', async () => {
  const { ownerA } = makeInstances();
  await ownerA.claim('ROOM01');

  const lockCalls = ownerA.client.calls.filter((c: any[]) => c[2] === SCHEDULER_LOCK_KEY('ROOM01'));
  assert.equal(lockCalls.length, 1, 'acquire-or-renew must be a single Redis round-trip');
  assert.equal(lockCalls[0][0], 'eval', 'the claim goes through an atomic Lua script');
  const script = lockCalls[0][1];
  assert.ok(script.includes('NX'), 'script acquires with NX');
  assert.ok(script.includes('pexpire'), 'script renews with PEXPIRE only when still self-owned');
});

test('a surviving instance takes over once the owner lock expires', async () => {
  const { ownerA, ownerB, advance } = makeInstances();
  assert.equal(await ownerA.claim('ROOM01'), true);
  assert.equal(await ownerB.claim('ROOM01'), false, 'B is locked out while A holds');

  advance(31000); // lock TTL (30s) lapses: A is gone

  assert.equal(await ownerB.claim('ROOM01'), true, 'B acquires the expired lock');
  assert.equal(await ownerA.claim('ROOM01'), false, 'the old owner lost ownership');
});

// ─── 2. Non-owner skips local scheduling ──────────────────────────

test('non-owner arms no local timer and no AI schedule; it signals the owner instead', async () => {
  const { bus, ownerA, ownerB } = makeInstances();
  const originalDecide = aiManager.decide;
  const originalDecideWithRules = aiManager.decideWithRules;
  let decideCalls = 0;
  const countingDecision = async () => {
    decideCalls += 1;
    return { type: 'call', amount: 0, delayMs: 5 };
  };
  aiManager.decide = countingDecision;
  aiManager.decideWithRules = countingDecision;

  try {
    await startGameWithBot();
    const io = createIoRecorder();

    assert.equal(await ownerA.claim('ROOM01'), true, 'A is the room owner');

    // B processes the turn broadcast (its locally-connected player acted).
    setupSocketHandlers(io, { scheduler: ownerB });
    await ownerB.start();
    await _broadcastGameTurn(io, 'ROOM01');
    await sleep(80);

    assert.equal(_hasTurnTimer('ROOM01'), false, 'non-owner arms no local turn timer');
    assert.equal(decideCalls, 0, 'non-owner schedules no AI decision');

    const signals = bus.published.filter(p => p.channel === SCHEDULER_CHANNEL);
    assert.equal(signals.length, 1, 'exactly one turn signal is published for the owner');
    const signal = JSON.parse(signals[0].message);
    assert.equal(signal.roomId, 'ROOM01');
    assert.equal(signal.playerId, 'bot-1');
    assert.equal(signal.seatPosition, 1);
    assert.equal(typeof signal.timeoutAt, 'number');

    // The client-facing broadcast still went out from the non-owner.
    const turnEmits = io.events.filter(e => e.event === 'game:turn' || String(e.event).includes('turn'));
    assert.ok(turnEmits.length > 0, 'game:turn broadcast still reaches clients');

    // The signal handler on B itself must stay inert (A holds the lock):
    // B already received its own published signal via the bus above.
    assert.equal(_hasTurnTimer('ROOM01'), false, 'signal receipt does not make a non-owner schedule');
  } finally {
    aiManager.decide = originalDecide;
    aiManager.decideWithRules = originalDecideWithRules;
  }
});

// ─── 3. Owner schedules from the signal; takeover after expiry ────

test('owner receiving a turn signal schedules locally with the signal deadline', async () => {
  const { ownerA, ownerB } = makeInstances();
  const originalDecide = aiManager.decide;
  const originalDecideWithRules = aiManager.decideWithRules;
  let decideCalls = 0;
  const countingDecision = async () => {
    decideCalls += 1;
    // Slow enough that the turn snapshot can be asserted before the bot
    // acts and the next turn overwrites it.
    return { type: 'call', amount: 0, delayMs: 100 };
  };
  aiManager.decide = countingDecision;
  aiManager.decideWithRules = countingDecision;

  try {
    await startGameWithBot();
    const io = createIoRecorder();

    // A is the active owner instance in this process.
    setupSocketHandlers(io, { scheduler: ownerA });
    await ownerA.start();
    assert.equal(await ownerA.claim('ROOM01'), true);

    const signalTimeoutAt = Date.now() + 30000;
    await ownerB.notifyTurn('ROOM01', {
      seatPosition: 1,
      playerId: 'bot-1',
      timeoutAt: signalTimeoutAt,
    });
    await sleep(40);

    assert.equal(_hasTurnTimer('ROOM01'), true, 'the owner arms the turn timer from the signal');
    assert.equal(decideCalls, 1, 'the owner schedules exactly one AI decision');

    const snap = await ownerA.readTurnSnapshot('ROOM01');
    assert.equal(snap.timeoutAt, signalTimeoutAt, 'the shared snapshot keeps the signal deadline');
    assert.equal(snap.playerId, 'bot-1');

    // The scheduled AI decision executed exactly once against the engine.
    await sleep(140);
    const state = await gameEngine.getGameState('ROOM01', null);
    assert.equal(state.currentPosition, 2, 'the bot acted exactly once');
  } finally {
    aiManager.decide = originalDecide;
    aiManager.decideWithRules = originalDecideWithRules;
  }
});

test('after owner lock expiry a surviving instance takes over at the next scheduling point', async () => {
  const { ownerA, ownerB, advance } = makeInstances();
  await startGameWithBot();
  const io = createIoRecorder();

  assert.equal(await ownerA.claim('ROOM01'), true, 'A owns the room');
  advance(31000); // A crashes; the lock lapses

  // B processes the next turn broadcast (a scheduling point) and takes over.
  setupSocketHandlers(io, { scheduler: ownerB });
  await ownerB.start();

  const before = Date.now();
  await _broadcastGameTurn(io, 'ROOM01');
  const after = Date.now();

  assert.equal(_hasTurnTimer('ROOM01'), true, 'the new owner rebuilds the turn timeout');
  assert.equal(await ownerB.client.get(SCHEDULER_LOCK_KEY('ROOM01')), 'instance-B', 'B is the new owner');

  const snap = await ownerB.readTurnSnapshot('ROOM01');
  assert.ok(snap, 'a fresh turn snapshot is written');
  // Simplified takeover semantics: deadline = now + full action duration.
  assert.ok(snap.timeoutAt >= before + 30000 && snap.timeoutAt <= after + 30000,
    `rebuilt deadline uses now + full duration (got ${snap.timeoutAt}, window [${before + 30000}, ${after + 30000}])`);
});

test('expired turn signals are dropped without touching the lock or the game', async () => {
  const { ownerA, ownerB } = makeInstances();
  await startGameWithBot();
  const io = createIoRecorder();

  setupSocketHandlers(io, { scheduler: ownerA });
  await ownerA.start();

  ownerA.client.calls.length = 0;
  await ownerB.notifyTurn('ROOM01', {
    seatPosition: 1,
    playerId: 'bot-1',
    timeoutAt: Date.now() - 1000, // already elapsed
  });
  await sleep(50);

  assert.equal(_hasTurnTimer('ROOM01'), false, 'an expired signal arms no timer');
  assert.equal(
    ownerA.client.calls.filter((c: any[]) => c[0] === 'eval').length,
    0,
    'an expired signal is dropped before any lock claim'
  );
  const state = await gameEngine.getGameState('ROOM01', null);
  assert.equal(state.currentPosition, 1, 'the game is untouched by the expired signal');
});

test('a Redis failure during scheduling does not break the client broadcast', async () => {
  const { bus } = makeInstances();
  const brokenClient = {
    async eval() { throw new Error('redis down'); },
    async set() { throw new Error('redis down'); },
    async get() { throw new Error('redis down'); },
    async pexpire() { throw new Error('redis down'); },
    async publish() { throw new Error('redis down'); },
  };
  const brokenScheduler = new SchedulerOwner({ client: brokenClient, instanceId: 'instance-X' });

  await startGameWithBot();
  const io = createIoRecorder();
  setupSocketHandlers(io, { scheduler: brokenScheduler });

  // Must not throw even though claim/notify both fail.
  await _broadcastGameTurn(io, 'ROOM01');

  const turnEmits = io.events.filter(e => e.target === 'ROOM01');
  assert.ok(turnEmits.length > 0, 'the room broadcast still reaches clients');
  assert.equal(_hasTurnTimer('ROOM01'), false, 'no timer was armed (fail-safe: never two)');
  assert.ok(bus.published.length === 0, 'nothing was published through the broken client');
});

test('stale turn signals are dropped when the turn has already moved on', async () => {
  const { ownerA, ownerB } = makeInstances();
  await startGameWithBot();
  const io = createIoRecorder();

  setupSocketHandlers(io, { scheduler: ownerA });
  await ownerA.start();
  assert.equal(await ownerA.claim('ROOM01'), true);

  // Signal describes seat 2 while the current turn belongs to seat 1.
  await ownerB.notifyTurn('ROOM01', {
    seatPosition: 2,
    playerId: 'human-2',
    timeoutAt: Date.now() + 30000,
  });
  await sleep(50);

  assert.equal(_hasTurnTimer('ROOM01'), false, 'a stale signal arms no timer');
  const state = await gameEngine.getGameState('ROOM01', null);
  assert.equal(state.currentPosition, 1, 'the game is untouched by the stale signal');
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
