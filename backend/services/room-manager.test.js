const test = require('node:test');
const assert = require('node:assert/strict');

const roomManager = require('./room-manager');
const store = require('../storage/memory-store');

function resetStore() {
  store.players.clear();
  store.rooms.clear();
  store.games.clear();
  store.sockets.clear();
  store.playerSockets.clear();
}

async function createPlayer(id, isAI = false) {
  const player = {
    id,
    nickname: isAI ? `Bot-${id}` : id,
    avatar: '#2ecc71',
    chips: 1000,
    isAI,
    isGuest: true,
    isOnline: !isAI,
    currentRoom: 'ROOM01',
  };
  await store.createPlayer(player);
  return player;
}

function createRoom(overrides = {}) {
  return {
    id: 'ROOM01',
    name: 'AI Room',
    hostId: 'old-host',
    maxPlayers: 6,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: true,
    isPrivate: false,
    status: 'waiting',
    players: [
      { playerId: 'old-host', nickname: 'Old Host', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'bot-1', nickname: 'Bot-One', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: true },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
    ],
    seats: ['old-host', 'bot-1', 'human-2', null, null, null, null, null, null],
    chatHistory: [],
    currentGameId: null,
    dealerPosition: null,
    createdAt: Date.now(),
    gameStartedAt: null,
    ...overrides,
  };
}

test('host leaving settles everyone and deletes the room', async () => {
  resetStore();
  await createPlayer('old-host', false);
  await createPlayer('bot-1', true);
  await createPlayer('human-2', false);
  await store.createRoom(createRoom({
    players: [
      { playerId: 'old-host', nickname: 'Old Host', avatar: '#111', seatPosition: 0, isReady: true, chips: 800, buyInTotal: 1000, borrowCount: 0, isAI: false },
      { playerId: 'bot-1', nickname: 'Bot-One', avatar: '#222', seatPosition: 1, isReady: true, chips: 1200, buyInTotal: 1000, borrowCount: 0, isAI: true },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#333', seatPosition: 2, isReady: true, chips: 500, buyInTotal: 2000, borrowCount: 1, isAI: false },
    ],
  }));

  const result = await roomManager.leaveRoom('ROOM01', 'old-host');

  assert.equal(result.success, true);
  assert.equal(result.roomDeleted, true);
  assert.equal(result.hostLeft, true);
  assert.equal(await store.getRoom('ROOM01'), null);
  assert.deepEqual(result.settlements.map(s => ({
    playerId: s.playerId,
    chips: s.chips,
    buyInTotal: s.buyInTotal,
    borrowCount: s.borrowCount,
    netResult: s.netResult,
  })), [
    { playerId: 'old-host', chips: 800, buyInTotal: 1000, borrowCount: 0, netResult: -200 },
    { playerId: 'bot-1', chips: 1200, buyInTotal: 1000, borrowCount: 0, netResult: 200 },
    { playerId: 'human-2', chips: 500, buyInTotal: 2000, borrowCount: 1, netResult: -1500 },
  ]);
});

test('joining a room uses room initial chips and initializes buy-in ledger', async () => {
  resetStore();
  const player = await createPlayer('new-human', false);
  player.chips = 9999;
  await store.createRoom(createRoom({
    initialChips: 1500,
    players: [],
    seats: [null, null, null, null, null, null, null, null, null],
  }));

  const result = await roomManager.joinRoom('ROOM01', 'new-human');
  const room = await store.getRoom('ROOM01');
  const joined = room.players.find(p => p.playerId === 'new-human');

  assert.equal(result.success, true);
  assert.equal(joined.chips, 1500);
  assert.equal(joined.buyInTotal, 1500);
  assert.equal(joined.borrowCount, 0);
});

test('a seated player with no chips can borrow one initial stack', async () => {
  resetStore();
  await createPlayer('old-host', false);
  await store.createRoom(createRoom({
    players: [
      { playerId: 'old-host', nickname: 'Old Host', avatar: '#111', seatPosition: 0, isReady: false, chips: 0, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
    seats: ['old-host', null, null, null, null, null, null, null, null],
  }));

  const result = await roomManager.borrowChips('ROOM01', 'old-host');
  const room = await store.getRoom('ROOM01');
  const player = room.players[0];

  assert.equal(result.success, true);
  assert.equal(player.chips, 1000);
  assert.equal(player.buyInTotal, 2000);
  assert.equal(player.borrowCount, 1);
  assert.equal(result.settlement.netResult, -1000);
});

test('leaving as a non-host settles only that player and clears their room chips', async () => {
  resetStore();
  await createPlayer('old-host', false);
  await createPlayer('human-2', false);
  await store.createRoom(createRoom({
    players: [
      { playerId: 'old-host', nickname: 'Old Host', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#333', seatPosition: 2, isReady: true, chips: 350, buyInTotal: 2000, borrowCount: 1, isAI: false },
    ],
    seats: ['old-host', null, 'human-2', null, null, null, null, null, null],
  }));

  const result = await roomManager.leaveRoom('ROOM01', 'human-2');
  const room = await store.getRoom('ROOM01');
  const player = await store.getPlayer('human-2');

  assert.equal(result.success, true);
  assert.equal(result.roomDeleted, undefined);
  assert.equal(result.settlement.netResult, -1650);
  assert.equal(room.players.some(p => p.playerId === 'human-2'), false);
  assert.equal(room.hostId, 'old-host');
  assert.equal(player.currentRoom, null);
  assert.equal(player.chips, 0);
});

test('rooms cannot start while a seated player has no chips', async () => {
  resetStore();
  await createPlayer('old-host', false);
  await createPlayer('human-2', false);
  await store.createRoom(createRoom({
    players: [
      { playerId: 'old-host', nickname: 'Old Host', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#333', seatPosition: 2, isReady: true, chips: 0, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
    seats: ['old-host', null, 'human-2', null, null, null, null, null, null],
  }));

  assert.equal(await roomManager.canStart('ROOM01'), false);
});

test('a seated player with no chips cannot ready before borrowing', async () => {
  resetStore();
  await createPlayer('old-host', false);
  await store.createRoom(createRoom({
    players: [
      { playerId: 'old-host', nickname: 'Old Host', avatar: '#111', seatPosition: 0, isReady: false, chips: 0, buyInTotal: 1000, borrowCount: 0, isAI: false },
    ],
    seats: ['old-host', null, null, null, null, null, null, null, null],
  }));

  const result = await roomManager.ready('ROOM01', 'old-host', true);

  assert.equal(result.success, false);
  assert.match(result.error, /borrow/i);
});

test('human can start when the current host is an AI player', async () => {
  resetStore();
  await createPlayer('bot-1', true);
  await createPlayer('human-2', false);
  await store.createRoom(createRoom({
    hostId: 'bot-1',
    players: [
      { playerId: 'bot-1', nickname: 'Bot-One', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: true },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
    ],
    seats: [null, 'bot-1', 'human-2', null, null, null, null, null, null],
  }));

  const result = await roomManager.startGame('ROOM01', 'human-2');

  assert.equal(result.success, true);
  assert.equal((await store.getRoom('ROOM01')).hostId, 'human-2');
});

test('adds exactly one AI player to the first open seat', async () => {
  resetStore();
  await createPlayer('old-host', false);
  await store.createRoom(createRoom({
    maxPlayers: 3,
    players: [
      { playerId: 'old-host', nickname: 'Old Host', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
    ],
    seats: ['old-host', null, null, null, null, null, null, null, null],
  }));

  const fakeAIManager = {
    createdPositions: [],
    async createBot(roomId, position) {
      this.createdPositions.push(position);
      const botId = `bot-${position}`;
      await createPlayer(botId, true);
      await roomManager.joinRoom(roomId, botId);
      await roomManager.sit(roomId, botId, position);
      await roomManager.ready(roomId, botId, true);
      return { id: botId };
    },
  };

  const result = await roomManager.addAI('ROOM01', fakeAIManager);
  const room = await store.getRoom('ROOM01');

  assert.equal(result.success, true);
  assert.deepEqual(fakeAIManager.createdPositions, [1]);
  assert.equal(room.players.length, 2);
  assert.equal(room.seats[1], 'bot-1');
});

test('removes an AI player from a requested waiting-room seat', async () => {
  resetStore();
  await createPlayer('old-host', false);
  await createPlayer('bot-1', true);
  await store.createRoom(createRoom({
    maxPlayers: 3,
    players: [
      { playerId: 'old-host', nickname: 'Old Host', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'bot-1', nickname: 'Bot-One', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: true },
    ],
    seats: ['old-host', 'bot-1', null, null, null, null, null, null, null],
  }));

  const fakeAIManager = {
    removedPositions: [],
    async removeBot(roomId, position) {
      this.removedPositions.push(position);
      await roomManager.leaveRoom(roomId, 'bot-1');
      return true;
    },
  };

  const result = await roomManager.removeAI('ROOM01', 1, fakeAIManager);
  const room = await store.getRoom('ROOM01');

  assert.equal(result.success, true);
  assert.deepEqual(fakeAIManager.removedPositions, [1]);
  assert.equal(room.seats[1], null);
  assert.equal(room.players.some(p => p.playerId === 'bot-1'), false);
});
