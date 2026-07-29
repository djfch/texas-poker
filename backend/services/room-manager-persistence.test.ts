/**
 * backend/services/room-manager-persistence.test.ts - Write-through persistence
 *
 * Every room-manager write path must call store.updateRoom()/updatePlayer()
 * after mutating. The memory store hands out live objects, so those calls
 * self-assign (no-op) there; copy-returning stores (Redis JSON round-trip)
 * depend on them to survive. These tests spy on the shared store singleton
 * and assert each mutation path writes through, and that a failing
 * write-back is logged and rethrown — never swallowed.
 */

const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const roomManager = require('./room-manager');
const store = require('../storage/memory-store');

// ─── Fixtures ────────────────────────────────────────────────────

function resetStore() {
  store.players.clear();
  store.rooms.clear();
  store.games.clear();
  store.sockets.clear();
  store.playerSockets.clear();
}

async function createPlayer(id: string, isAI = false) {
  const player = {
    id,
    nickname: isAI ? `Bot-${id}` : id,
    avatar: '#2ecc71',
    chips: 1000,
    isAI,
    isGuest: true,
    isOnline: !isAI,
    currentRoom: null,
  };
  await store.createPlayer(player);
  return player;
}

function createRoom(overrides: Record<string, any> = {}) {
  return {
    id: 'ROOM01',
    name: 'Persistence Room',
    hostId: 'human-1',
    maxPlayers: 6,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: true,
    isPrivate: false,
    status: 'waiting',
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: false, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 2, isReady: false, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
    seats: ['human-1', null, 'human-2', null, null, null, null, null, null],
    chatHistory: [],
    currentGameId: null,
    dealerPosition: null,
    awaitingNextHandReady: false,
    createdAt: Date.now(),
    gameStartedAt: null,
    ...overrides,
  };
}

// ─── Store spies ─────────────────────────────────────────────────

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

// ─── Write-path assertions ───────────────────────────────────────

test('joinRoom writes the new member and player link through', async () => {
  await createPlayer('human-1');
  await createPlayer('human-2');
  await createPlayer('stranger');
  await store.createRoom(createRoom());
  const calls = spyOnStore();

  const result = await roomManager.joinRoom('ROOM01', 'stranger');

  assert.equal(result.success, true);
  const roomWrite = calls.updateRoom.find(c => c.id === 'ROOM01');
  assert.ok(roomWrite, 'joinRoom must call store.updateRoom');
  const joined = roomWrite.updates.players.find((p: any) => p.playerId === 'stranger');
  assert.ok(joined, 'written room must contain the new member');
  assert.equal(joined.chips, 1000);
  assert.equal(joined.buyInTotal, 1000);
  assert.equal(joined.borrowCount, 0);

  const playerWrite = calls.updatePlayer.find(c => c.id === 'stranger');
  assert.ok(playerWrite, 'joinRoom must call store.updatePlayer');
  assert.equal(playerWrite.updates.currentRoom, 'ROOM01');
  assert.equal(playerWrite.updates.seatPosition, -1);
  assert.equal(playerWrite.updates.isReady, false);
  assert.equal(playerWrite.updates.chips, 1000);
});

test('joinRoom force-leaves the old room and persists both rooms', async () => {
  await createPlayer('human-1');
  await createPlayer('human-2');
  await createPlayer('nomad');
  await createPlayer('resident');
  await store.createRoom(createRoom());
  await store.createRoom(createRoom({
    id: 'ROOM02',
    hostId: 'resident',
    players: [
      { playerId: 'resident', nickname: 'resident', avatar: '#444', seatPosition: 0, isReady: false, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
      { playerId: 'nomad', nickname: 'nomad', avatar: '#333', seatPosition: 1, isReady: false, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
    seats: ['resident', 'nomad', null, null, null, null, null, null, null],
  }));
  const nomad = await store.getPlayer('nomad');
  nomad.currentRoom = 'ROOM02';
  const calls = spyOnStore();

  const result = await roomManager.joinRoom('ROOM01', 'nomad');

  assert.equal(result.success, true);
  const oldRoomWrite = calls.updateRoom.find(c => c.id === 'ROOM02');
  assert.ok(oldRoomWrite, 'leaving the old room must write it back');
  assert.equal(oldRoomWrite.updates.players.some((p: any) => p.playerId === 'nomad'), false);
  assert.equal(oldRoomWrite.updates.seats[1], null);
  const newRoomWrite = calls.updateRoom.find(c => c.id === 'ROOM01');
  assert.ok(newRoomWrite, 'joining the new room must write it back');
  assert.ok(newRoomWrite.updates.players.some((p: any) => p.playerId === 'nomad'));
});

test('sit writes the seat map and the stored player seat through', async () => {
  await createPlayer('human-1');
  await createPlayer('human-2');
  await createPlayer('stranger');
  await store.createRoom(createRoom({
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: false, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
      { playerId: 'stranger', nickname: 'stranger', avatar: '#333', seatPosition: -1, isReady: false, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
    seats: ['human-1', null, null, null, null, null, null, null, null],
  }));
  const calls = spyOnStore();

  const result = await roomManager.sit('ROOM01', 'stranger', 3);

  assert.equal(result.success, true);
  const roomWrite = calls.updateRoom.find(c => c.id === 'ROOM01');
  assert.ok(roomWrite, 'sit must call store.updateRoom');
  assert.equal(roomWrite.updates.seats[3], 'stranger');
  const playerWrite = calls.updatePlayer.find(c => c.id === 'stranger');
  assert.ok(playerWrite, 'sit must call store.updatePlayer');
  assert.equal(playerWrite.updates.seatPosition, 3);
  assert.equal(playerWrite.updates.isReady, false);
});

test('stand writes the freed seat and the stored player through', async () => {
  await createPlayer('human-1');
  await createPlayer('human-2');
  await store.createRoom(createRoom());
  const calls = spyOnStore();

  const result = await roomManager.stand('ROOM01', 'human-2');

  assert.equal(result.success, true);
  const roomWrite = calls.updateRoom.find(c => c.id === 'ROOM01');
  assert.ok(roomWrite, 'stand must call store.updateRoom');
  assert.equal(roomWrite.updates.seats[2], null);
  const roomPlayer = roomWrite.updates.players.find((p: any) => p.playerId === 'human-2');
  assert.equal(roomPlayer.seatPosition, -1);
  const playerWrite = calls.updatePlayer.find(c => c.id === 'human-2');
  assert.ok(playerWrite, 'stand must call store.updatePlayer');
  assert.equal(playerWrite.updates.seatPosition, -1);
});

test('ready writes the flag on both the room entry and the player', async () => {
  await createPlayer('human-1');
  await createPlayer('human-2');
  await store.createRoom(createRoom());
  const calls = spyOnStore();

  const result = await roomManager.ready('ROOM01', 'human-1', true);

  assert.equal(result.success, true);
  const roomWrite = calls.updateRoom.find(c => c.id === 'ROOM01');
  assert.ok(roomWrite, 'ready must call store.updateRoom');
  assert.equal(roomWrite.updates.players.find((p: any) => p.playerId === 'human-1').isReady, true);
  const playerWrite = calls.updatePlayer.find(c => c.id === 'human-1');
  assert.ok(playerWrite, 'ready must call store.updatePlayer');
  assert.equal(playerWrite.updates.isReady, true);
});

test('borrowChips writes the ledger and the stored player chips through', async () => {
  await createPlayer('human-1');
  await store.createRoom(createRoom({
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: false, chips: 0, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
    seats: ['human-1', null, null, null, null, null, null, null, null],
  }));
  const calls = spyOnStore();

  const result = await roomManager.borrowChips('ROOM01', 'human-1');

  assert.equal(result.success, true);
  const roomWrite = calls.updateRoom.find(c => c.id === 'ROOM01');
  assert.ok(roomWrite, 'borrowChips must call store.updateRoom');
  const roomPlayer = roomWrite.updates.players.find((p: any) => p.playerId === 'human-1');
  assert.equal(roomPlayer.chips, 1000);
  assert.equal(roomPlayer.buyInTotal, 2000);
  assert.equal(roomPlayer.borrowCount, 1);
  const playerWrite = calls.updatePlayer.find(c => c.id === 'human-1');
  assert.ok(playerWrite, 'borrowChips must call store.updatePlayer');
  assert.equal(playerWrite.updates.chips, 1000);
  assert.equal(playerWrite.updates.isReady, false);
});

test('autoLendToBrokeAI writes each lent bot and the room once', async () => {
  await createPlayer('human-1');
  await createPlayer('bot-1', true);
  await store.createRoom(createRoom({
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: false, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
      { playerId: 'bot-1', nickname: 'Bot-One', avatar: '#222', seatPosition: 1, isReady: false, chips: 0, buyInTotal: 1000, borrowCount: 0, isAI: true },
    ],
    seats: ['human-1', 'bot-1', null, null, null, null, null, null, null],
  }));
  const calls = spyOnStore();

  const result = await roomManager.autoLendToBrokeAI('ROOM01');

  assert.equal(result.lent.length, 1);
  const roomWrites = calls.updateRoom.filter(c => c.id === 'ROOM01');
  assert.equal(roomWrites.length, 1, 'auto-lend must persist the room exactly once');
  const bot = roomWrites[0].updates.players.find((p: any) => p.playerId === 'bot-1');
  assert.equal(bot.chips, 1000);
  assert.equal(bot.borrowCount, 1);
  assert.equal(bot.isReady, true);
  const playerWrite = calls.updatePlayer.find(c => c.id === 'bot-1');
  assert.ok(playerWrite, 'auto-lend must persist the stored bot');
  assert.equal(playerWrite.updates.chips, 1000);
});

test('autoLendToBrokeAI writes nothing when no bot needs chips', async () => {
  await createPlayer('human-1');
  await createPlayer('bot-1', true);
  await store.createRoom(createRoom({
    players: [
      { playerId: 'bot-1', nickname: 'Bot-One', avatar: '#222', seatPosition: 1, isReady: false, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: true },
    ],
    seats: [null, 'bot-1', null, null, null, null, null, null, null],
  }));
  const calls = spyOnStore();

  const result = await roomManager.autoLendToBrokeAI('ROOM01');

  assert.equal(result.lent.length, 0);
  assert.equal(calls.updateRoom.length, 0, 'no mutation means no write-through');
  assert.equal(calls.updatePlayer.length, 0);
});

test('leaveRoom (non-host) writes the shrunken room and clears the player', async () => {
  await createPlayer('human-1');
  await createPlayer('human-2');
  await store.createRoom(createRoom());
  const calls = spyOnStore();

  const result = await roomManager.leaveRoom('ROOM01', 'human-2');

  assert.equal(result.success, true);
  const roomWrite = calls.updateRoom.find(c => c.id === 'ROOM01');
  assert.ok(roomWrite, 'leaveRoom must call store.updateRoom');
  assert.equal(roomWrite.updates.players.some((p: any) => p.playerId === 'human-2'), false);
  assert.equal(roomWrite.updates.seats[2], null);
  const playerWrite = calls.updatePlayer.find(c => c.id === 'human-2');
  assert.ok(playerWrite, 'leaveRoom must persist the cleared player state');
  assert.equal(playerWrite.updates.currentRoom, null);
  assert.equal(playerWrite.updates.chips, 0);
});

test('leaveRoom (host) clears every player and deletes without updateRoom', async () => {
  await createPlayer('human-1');
  await createPlayer('human-2');
  await store.createRoom(createRoom());
  const calls = spyOnStore();

  const result = await roomManager.leaveRoom('ROOM01', 'human-1');

  assert.equal(result.success, true);
  assert.equal(result.roomDeleted, true);
  assert.equal(calls.updateRoom.length, 0, 'a deleted room needs no write-back');
  const clearedIds = calls.updatePlayer.map(c => c.id).sort();
  assert.deepEqual(clearedIds, ['human-1', 'human-2']);
  for (const call of calls.updatePlayer) {
    assert.equal(call.updates.currentRoom, null);
    assert.equal(call.updates.chips, 0);
  }
  assert.equal(await store.getRoom('ROOM01'), null);
});

test('startGame writes status/gameStartedAt through', async () => {
  await createPlayer('human-1');
  await createPlayer('human-2');
  await store.createRoom(createRoom({
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 2, isReady: true, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
  }));
  const calls = spyOnStore();

  const result = await roomManager.startGame('ROOM01', 'human-1');

  assert.equal(result.success, true);
  const roomWrite = calls.updateRoom.find(c => c.id === 'ROOM01');
  assert.ok(roomWrite, 'startGame must call store.updateRoom');
  assert.equal(roomWrite.updates.status, 'playing');
  assert.equal(typeof roomWrite.updates.gameStartedAt, 'number');
  assert.equal(roomWrite.updates.awaitingNextHandReady, false);
});

test('startGame persists a host transfer even when the start check fails', async () => {
  // The memory store's live reference made this observable before P5c;
  // copy-returning stores must match it byte-for-byte.
  await createPlayer('human-2');
  await createPlayer('bot-1', true);
  await store.createRoom(createRoom({
    hostId: 'bot-1',
    players: [
      { playerId: 'bot-1', nickname: 'Bot-One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: true },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 2, isReady: false, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
    seats: ['bot-1', null, 'human-2', null, null, null, null, null, null],
  }));
  const calls = spyOnStore();

  const result = await roomManager.startGame('ROOM01', 'human-2');

  assert.equal(result.success, false);
  const roomWrite = calls.updateRoom.find(c => c.id === 'ROOM01');
  assert.ok(roomWrite, 'the host transfer must be written back even on failure');
  assert.equal(roomWrite.updates.hostId, 'human-2');
  assert.equal((await store.getRoom('ROOM01')).hostId, 'human-2');
});

test('setStatus writes the lifecycle fields through', async () => {
  await createPlayer('human-1');
  await store.createRoom(createRoom());
  const calls = spyOnStore();

  const ok = await roomManager.setStatus('ROOM01', 'playing');

  assert.equal(ok, true);
  const roomWrite = calls.updateRoom.find(c => c.id === 'ROOM01');
  assert.ok(roomWrite, 'setStatus must call store.updateRoom');
  assert.equal(roomWrite.updates.status, 'playing');
  assert.equal(typeof roomWrite.updates.gameStartedAt, 'number');
});

// ─── Failure semantics ───────────────────────────────────────────

test('a failing room write-back is logged and rethrown (joinRoom)', async () => {
  await createPlayer('human-1');
  await createPlayer('human-2');
  await createPlayer('stranger');
  await store.createRoom(createRoom());
  spyOnStore();
  store.updateRoom = async () => { throw new Error('redis down'); };

  const errors: any[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => { errors.push(args); };
  try {
    await assert.rejects(() => roomManager.joinRoom('ROOM01', 'stranger'), /redis down/);
  } finally {
    console.error = originalError;
  }
  assert.ok(errors.some(args => String(args[0]).includes('Failed to persist room')));
});

test('a failing player write-back is logged and rethrown (ready)', async () => {
  await createPlayer('human-1');
  await store.createRoom(createRoom());
  spyOnStore();
  store.updatePlayer = async () => { throw new Error('redis down'); };

  const errors: any[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => { errors.push(args); };
  try {
    await assert.rejects(() => roomManager.ready('ROOM01', 'human-1', true), /redis down/);
  } finally {
    console.error = originalError;
  }
  assert.ok(errors.some(args => String(args[0]).includes('Failed to persist player')));
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
