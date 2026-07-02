const test = require('node:test');
const assert = require('node:assert/strict');

const aiManager = require('./ai-manager');
const store = require('../storage/memory-store');

function resetStore() {
  store.players.clear();
  store.rooms.clear();
  store.games.clear();
  store.sockets.clear();
  store.playerSockets.clear();
}

async function createHostPlayer() {
  const player = {
    id: 'host-1',
    nickname: 'Host One',
    avatar: '#111',
    chips: 1000,
    isAI: false,
    isGuest: true,
    isOnline: true,
    currentRoom: 'ROOM01',
  };
  await store.createPlayer(player);
  return player;
}

function createRoom() {
  return {
    id: 'ROOM01',
    name: 'AI Room',
    hostId: 'host-1',
    maxPlayers: 3,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: true,
    isPrivate: false,
    status: 'waiting',
    players: [
      {
        playerId: 'host-1',
        nickname: 'Host One',
        avatar: '#111',
        seatPosition: 0,
        isReady: true,
        chips: 1000,
        buyInTotal: 1000,
        borrowCount: 0,
        isAI: false,
      },
    ],
    seats: ['host-1', null, null, null, null, null, null, null, null],
    chatHistory: [],
    currentGameId: null,
    dealerPosition: null,
    awaitingNextHandReady: false,
    createdAt: Date.now(),
    gameStartedAt: null,
  };
}

test('AI manager creates room-local unique bot nicknames', async () => {
  resetStore();
  await createHostPlayer();
  await store.createRoom(createRoom());

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;

    const firstBot = await aiManager.createBot('ROOM01', 1);
    const secondBot = await aiManager.createBot('ROOM01', 2);
    const room = await store.getRoom('ROOM01');
    const aiNicknames = room.players
      .filter(player => player.isAI)
      .map(player => player.nickname);

    assert.ok(firstBot);
    assert.ok(secondBot);
    assert.deepEqual(new Set(aiNicknames).size, aiNicknames.length);
    assert.equal(aiNicknames.length, 2);
  } finally {
    Math.random = originalRandom;
  }
});
