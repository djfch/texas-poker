/**
 * backend/socket/turn-concurrency.test.ts - Turn concurrency regression tests
 *
 * Regression coverage for the three turn-handling invariants:
 *  INV1: at most one game-state mutation flow per room at any moment
 *        (human action, timeout fold, AI callback and hand start are
 *        serialized through a per-room queue).
 *  INV2: at most one effective turn timer per room; the timer handle lives
 *        in the scheduler layer, never on the stored game entity, and a
 *        superseded timer must never fire.
 *  INV3: an AI decision is scheduled at most once per (game, position, turn);
 *        the decision re-validates the turn before executing and stale
 *        decisions are dropped.
 */
const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const gameEngine = require('../services/game-engine');
const aiManager = require('../services/ai-manager');
const store = require('../storage/memory-store');
const {
  _scheduleTurnTimeout,
  _cancelTurnTimer,
  _broadcastGameTurn,
} = require('./handlers');

function resetStore() {
  store.players.clear();
  store.rooms.clear();
  store.games.clear();
  store.sockets.clear();
  store.playerSockets.clear();
}

test.afterEach(() => {
  // _cancelTurnTimer only exists after the scheduler refactor; guard so the
  // regression run against the pre-fix code does not mask test outcomes.
  if (typeof _cancelTurnTimer === 'function') _cancelTurnTimer('ROOM01');
  resetStore();
});

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createPlayer(id: string, seatPosition: number, isAI = false) {
  const player = {
    id,
    nickname: id,
    avatar: '#2ecc71',
    chips: 1000,
    isAI,
    isGuest: true,
    isOnline: true,
    currentRoom: 'ROOM01',
    seatPosition,
  };
  await store.createPlayer(player);
  return player;
}

function createRoom(seats?: any[]) {
  const roster = seats || [
    { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
    { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: false },
    { playerId: 'human-3', nickname: 'Human Three', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
  ];
  return {
    id: 'ROOM01',
    name: 'Concurrency Room',
    hostId: 'human-1',
    maxPlayers: roster.length,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: true,
    isPrivate: false,
    status: 'playing',
    players: roster,
    seats: roster.map(p => p.playerId).concat(Array(9 - roster.length).fill(null)),
    chatHistory: [],
    currentGameId: null,
    dealerPosition: null,
    createdAt: Date.now(),
    gameStartedAt: Date.now(),
  };
}

function createIoRecorder() {
  const events: any[] = [];
  return {
    events,
    to(target: string) {
      return {
        emit(event: string, payload: any) {
          events.push({ target, event, payload });
        },
      };
    },
  };
}

// ─── INV1 ─────────────────────────────────────────────────────────

test('INV1: concurrent human action and timeout fold only take effect once', async () => {
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await createPlayer('human-3', 2);
  await store.createRoom(createRoom());
  assert.equal((await gameEngine.startGame('ROOM01')).success, true);

  // Seat 0 and seat 1 call, leaving the big blind (seat 2) to act with
  // everyone matched at 20. A check here completes the preflop round.
  assert.equal((await gameEngine.handleAction('ROOM01', 'human-1', 'call')).success, true);
  assert.equal((await gameEngine.handleAction('ROOM01', 'human-2', 'call')).success, true);

  // Fire the human check and the timeout fold for the same seat concurrently.
  const [actionResult, timeoutResult] = await Promise.all([
    gameEngine.handleAction('ROOM01', 'human-3', 'check'),
    gameEngine.timeoutFold('ROOM01', 2),
  ]);

  assert.equal(actionResult.success, true, 'the first-arriving action must win');
  assert.equal(timeoutResult.success, false, 'the late timeout fold must be rejected');

  const state = await gameEngine.getGameState('ROOM01', null);
  assert.equal(state.status, 'flop');
  assert.equal(state.communityCards.length, 3, 'the flop must be dealt exactly once');
  assert.equal(state.players.find((p: any) => p.seatPosition === 2).folded, false);
  assert.equal(state.currentPosition, 1, 'the turn must advance exactly once');
});

test('INV1: concurrent startGame calls only create one game', async () => {
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await store.createRoom(createRoom([
    { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
    { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: false },
  ]));

  const [first, second] = await Promise.all([
    gameEngine.startGame('ROOM01'),
    gameEngine.startGame('ROOM01'),
  ]);

  assert.equal(first.success, true);
  assert.equal(second.success, false, 'a second concurrent start must be rejected');

  const state = await gameEngine.getGameState('ROOM01', null);
  assert.equal(state.status, 'preflop');
  assert.equal(state.totalPot, 30, 'blinds must be posted exactly once');
});

// ─── INV2 ─────────────────────────────────────────────────────────

test('INV2: superseded turn timer cannot fold the player of the next turn', async () => {
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await createPlayer('human-3', 2);
  await store.createRoom(createRoom());
  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  const io = createIoRecorder();

  // Arm a short timer for seat 0, then seat 0 acts and the turn moves on.
  _scheduleTurnTimeout(io, 'ROOM01', { seatPosition: 0, playerId: 'human-1' }, Date.now() + 50);
  assert.equal((await gameEngine.handleAction('ROOM01', 'human-1', 'call')).success, true);
  _scheduleTurnTimeout(io, 'ROOM01', { seatPosition: 1, playerId: 'human-2' }, Date.now() + 5000);

  // Timer handles must live in the scheduler layer, not on the game entity.
  const rawGame = await store.getGame('ROOM01');
  assert.ok(rawGame.timeoutId == null, 'timer handle must not be stored on the game entity');

  await sleep(120); // past the first timer's fire time

  const state = await gameEngine.getGameState('ROOM01', null);
  assert.equal(state.status, 'preflop');
  assert.equal(state.currentPosition, 1, 'the turn must stay with seat 1');
  assert.equal(state.players.find((p: any) => p.seatPosition === 0).folded, false);
  assert.equal(state.players.find((p: any) => p.seatPosition === 1).folded, false);
});

// ─── INV3 ─────────────────────────────────────────────────────────

test('INV3: duplicate AI scheduling for the same turn only decides once', async () => {
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
    await createPlayer('human-1', 0);
    await createPlayer('bot-1', 1, true);
    await createPlayer('human-2', 2);
    await store.createRoom(createRoom([
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'bot-1', nickname: 'Bot One', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: true },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
    ]));
    assert.equal((await gameEngine.startGame('ROOM01')).success, true);
    // Move the turn to the bot at seat 1.
    assert.equal((await gameEngine.handleAction('ROOM01', 'human-1', 'call')).success, true);

    const io = createIoRecorder();
    // Two broadcasts racing for the same turn must not double-schedule.
    await Promise.all([
      _broadcastGameTurn(io, 'ROOM01'),
      _broadcastGameTurn(io, 'ROOM01'),
    ]);
    await sleep(80); // let the scheduled AI decision execute

    assert.equal(decideCalls, 1, 'AI decision must be scheduled once per turn');

    const state = await gameEngine.getGameState('ROOM01', null);
    assert.equal(state.currentPosition, 2, 'the bot must act exactly once');
    assert.equal(state.totalPot, 60);
    assert.equal(state.players.find((p: any) => p.playerId === 'bot-1').chips, 980);
  } finally {
    aiManager.decide = originalDecide;
    aiManager.decideWithRules = originalDecideWithRules;
  }
});

test('INV3: stale AI decision is dropped once the turn has moved on', async () => {
  const originalDecide = aiManager.decide;
  const originalDecideWithRules = aiManager.decideWithRules;
  const originalHandleAction = gameEngine.handleAction;
  let engineCalls = 0;
  const slowDecision = async () => ({ type: 'call', amount: 0, delayMs: 20 });
  aiManager.decide = slowDecision;
  aiManager.decideWithRules = slowDecision;

  try {
    await createPlayer('human-1', 0);
    await createPlayer('bot-1', 1, true);
    await createPlayer('human-2', 2);
    await store.createRoom(createRoom([
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'bot-1', nickname: 'Bot One', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: true },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
    ]));
    assert.equal((await gameEngine.startGame('ROOM01')).success, true);
    assert.equal((await gameEngine.handleAction('ROOM01', 'human-1', 'call')).success, true);

    const io = createIoRecorder();
    await _broadcastGameTurn(io, 'ROOM01'); // schedules the bot decision (20ms delay)

    gameEngine.handleAction = (...args: any[]) => {
      engineCalls += 1;
      return originalHandleAction.apply(gameEngine, args);
    };

    // The bot acts through another path before its delayed decision fires.
    assert.equal((await gameEngine.handleAction('ROOM01', 'bot-1', 'call')).success, true);
    assert.equal(engineCalls, 1, 'only the direct action should reach the engine so far');

    await sleep(80); // the delayed decision fires now and must be dropped
    assert.equal(engineCalls, 1, 'the stale AI decision must not reach the engine');

    const state = await gameEngine.getGameState('ROOM01', null);
    assert.equal(state.currentPosition, 2);
    assert.equal(state.totalPot, 60);
  } finally {
    gameEngine.handleAction = originalHandleAction;
    aiManager.decide = originalDecide;
    aiManager.decideWithRules = originalDecideWithRules;
  }
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
