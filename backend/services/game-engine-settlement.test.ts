/**
 * backend/services/game-engine-settlement.test.ts - Showdown write-through
 *
 * _showdown settles chips onto room.players entries and player records.
 * Under the memory store those mutations hit live objects; copy-returning
 * stores (Redis JSON round-trip) need explicit updateRoom()/updatePlayer()
 * write-backs. These tests spy on the shared store singleton and assert
 * the settlement writes through, and that a failing write-back is logged
 * and rethrown — never swallowed.
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

interface StoreSpyCalls {
  updateRoom: Array<{ id: string; updates: any }>;
  updatePlayer: Array<{ id: string; updates: any }>;
}

let activeRestore: (() => void) | null = null;

/** Shadow the singleton's update methods with recording wrappers. */
function spyOnStore(): StoreSpyCalls {
  const calls: StoreSpyCalls = { updateRoom: [], updatePlayer: [] };
  const originalUpdateRoom = store.updateRoom;
  const originalUpdatePlayer = store.updatePlayer;

  store.updateRoom = async (id: string, updates: any) => {
    calls.updateRoom.push({ id, updates });
    return originalUpdateRoom.call(store, id, updates);
  };
  store.updatePlayer = async (id: string, updates: any) => {
    calls.updatePlayer.push({ id, updates });
    return originalUpdatePlayer.call(store, id, updates);
  };

  activeRestore = () => {
    // Deleting the own-properties restores the prototype methods.
    delete (store as any).updateRoom;
    delete (store as any).updatePlayer;
    activeRestore = null;
  };
  return calls;
}

test.afterEach(() => {
  if (activeRestore) activeRestore();
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
    name: 'Settlement Room',
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

test('showdown writes settled chips to every player record and the whole room', async () => {
  await setupHeadsUpRoom();
  const calls = spyOnStore();

  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  // Heads-up: seat 0 is dealer/small blind and acts first preflop.
  const result = await gameEngine.handleAction('ROOM01', 'human-1', 'fold');
  assert.equal(result.success, true);
  assert.equal(result.game.status, 'ended');

  // Loser posted the 10 small blind; winner takes the 30 pot.
  const loserWrite = calls.updatePlayer.find(c => c.id === 'human-1');
  assert.ok(loserWrite, 'settlement must persist the loser player record');
  assert.equal(loserWrite.updates.chips, 990);
  assert.equal(loserWrite.updates.isReady, false);
  const winnerWrite = calls.updatePlayer.find(c => c.id === 'human-2');
  assert.ok(winnerWrite, 'settlement must persist the winner player record');
  assert.equal(winnerWrite.updates.chips, 1010);
  assert.equal(winnerWrite.updates.isReady, false);

  const roomWrite = calls.updateRoom.find(c => c.id === 'ROOM01' && c.updates.status === 'waiting');
  assert.ok(roomWrite, 'settlement must persist the room');
  assert.equal(roomWrite.updates.currentGameId, null);
  assert.equal(roomWrite.updates.awaitingNextHandReady, true);
  assert.equal(roomWrite.updates.dealerPosition, 0);
  // The settled room must carry the nested players[] chip mutations —
  // the exact data a partial field update used to drop under Redis.
  const rpLoser = roomWrite.updates.players.find((p: any) => p.playerId === 'human-1');
  const rpWinner = roomWrite.updates.players.find((p: any) => p.playerId === 'human-2');
  assert.equal(rpLoser.chips, 990);
  assert.equal(rpWinner.chips, 1010);
});

test('a failing player write-back during settlement is logged and rethrown', async () => {
  await setupHeadsUpRoom();
  spyOnStore();
  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  store.updatePlayer = async () => { throw new Error('redis down'); };

  const errors: any[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => { errors.push(args); };
  try {
    await assert.rejects(() => gameEngine.handleAction('ROOM01', 'human-1', 'fold'), /redis down/);
  } finally {
    console.error = originalError;
  }
  assert.ok(errors.some(args => String(args[0]).includes('Failed to persist player')));
});

test('a failing room write-back during settlement is logged and rethrown', async () => {
  await setupHeadsUpRoom();
  spyOnStore();
  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  const originalUpdateRoom = store.updateRoom;
  store.updateRoom = async (id: string, updates: any) => {
    // Let the engine's own start/action writes through; fail only the
    // settlement write-back (the one carrying the waiting status).
    if (updates && updates.status === 'waiting') {
      throw new Error('redis down');
    }
    return originalUpdateRoom.call(store, id, updates);
  };

  const errors: any[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => { errors.push(args); };
  try {
    await assert.rejects(() => gameEngine.handleAction('ROOM01', 'human-1', 'fold'), /redis down/);
  } finally {
    console.error = originalError;
  }
  assert.ok(errors.some(args => String(args[0]).includes('Failed to persist room')));
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
