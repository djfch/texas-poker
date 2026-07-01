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

test('host handoff prefers a seated human over AI players', async () => {
  resetStore();
  await createPlayer('old-host', false);
  await createPlayer('bot-1', true);
  await createPlayer('human-2', false);
  await store.createRoom(createRoom());

  const result = await roomManager.leaveRoom('ROOM01', 'old-host');

  assert.equal(result.success, true);
  assert.equal((await store.getRoom('ROOM01')).hostId, 'human-2');
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
