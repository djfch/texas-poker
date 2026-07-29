/**
 * backend/services/game-engine-history.test.ts - Hand history persistence
 *
 * The engine writes one history entry per seated player at showdown when
 * the configured store implements the optional saveHandHistory() method,
 * and a failing history write must never break settlement.
 */

const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const gameEngine = require('./game-engine');
const store = require('../storage/memory-store');

function resetStore() {
  store.players.clear();
  store.rooms.clear();
  store.games.clear();
  store.sockets.clear();
  store.playerSockets.clear();
}

test.afterEach(() => {
  delete store.saveHandHistory;
  resetStore();
});

async function setupHeadsUpRoom() {
  for (const id of ['human-1', 'human-2']) {
    await store.createPlayer({
      id,
      nickname: id,
      avatar: '#2ecc71',
      chips: 1000,
      isGuest: true,
      isOnline: true,
      currentRoom: 'ROOM01',
    });
  }
  await store.createRoom({
    id: 'ROOM01',
    name: 'History Room',
    hostId: 'human-1',
    maxPlayers: 2,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: false,
    isPrivate: false,
    status: 'playing',
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: false },
    ],
    seats: ['human-1', 'human-2', null, null, null, null, null, null, null],
    chatHistory: [],
    currentGameId: null,
    dealerPosition: null,
    createdAt: Date.now(),
    gameStartedAt: Date.now(),
  });
}

test('settlement writes one history entry per player when saveHandHistory exists', async () => {
  const entries: any[] = [];
  store.saveHandHistory = async (entry: any) => { entries.push(entry); };

  await setupHeadsUpRoom();
  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  const result = await gameEngine.handleAction('ROOM01', 'human-1', 'fold');
  assert.equal(result.success, true);
  assert.equal(result.game.status, 'ended');

  assert.equal(entries.length, 2);
  const winner = entries.find(e => e.playerId === 'human-2');
  const loser = entries.find(e => e.playerId === 'human-1');
  assert.ok(winner && loser);

  assert.equal(winner.isWinner, true);
  assert.ok(winner.delta > 0);
  assert.equal(winner.roomId, 'ROOM01');
  assert.equal(winner.gameId, 'ROOM01');
  assert.equal(winner.holeCards.length, 2);
  assert.equal(typeof winner.holeCards[0], 'string');
  assert.equal(winner.startingChips, 1000);
  assert.equal(winner.finalChips, winner.startingChips + winner.delta);
  assert.equal(typeof winner.createdAt, 'number');
  assert.ok(Array.isArray(winner.summary.communityCards));

  assert.equal(loser.isWinner, false);
  assert.equal(loser.summary.folded, true);
  assert.equal(loser.delta, -10); // small blind posted before folding
});

test('a failing saveHandHistory is logged and never breaks settlement', async () => {
  const errors: any[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => { errors.push(args); };
  try {
    store.saveHandHistory = async () => { throw new Error('db down'); };

    await setupHeadsUpRoom();
    assert.equal((await gameEngine.startGame('ROOM01')).success, true);
    const result = await gameEngine.handleAction('ROOM01', 'human-1', 'fold');

    assert.equal(result.success, true);
    assert.equal(result.game.status, 'ended');
    assert.equal((await store.getRoom('ROOM01'))!.status, 'waiting');
    assert.ok(errors.some(args => String(args[0]).includes('Failed to save hand history')));
  } finally {
    console.error = originalError;
  }
});

test('no history write happens when the store lacks saveHandHistory', async () => {
  // The default memory store has no saveHandHistory; settlement must work
  // unchanged (regression guard for the optional-method probe).
  assert.equal(typeof store.saveHandHistory, 'undefined');

  await setupHeadsUpRoom();
  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  const result = await gameEngine.handleAction('ROOM01', 'human-1', 'fold');
  assert.equal(result.success, true);
  assert.equal(result.game.status, 'ended');
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
