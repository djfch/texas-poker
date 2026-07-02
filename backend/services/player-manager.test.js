const test = require('node:test');
const assert = require('node:assert/strict');

const playerManager = require('./player-manager');
const store = require('../storage/memory-store');

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

test('updating a nickname syncs the player, room seat, and active game player', async () => {
  await store.createPlayer({
    id: 'human-1',
    nickname: 'Old Name',
    avatar: '#111',
    chips: 1000,
    isGuest: true,
    isOnline: true,
    currentRoom: 'ROOM01',
    seatPosition: 0,
  });
  await store.createRoom({
    id: 'ROOM01',
    name: 'Rename Room',
    hostId: 'human-1',
    maxPlayers: 2,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: true,
    isPrivate: false,
    status: 'playing',
    players: [
      { playerId: 'human-1', nickname: 'Old Name', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
    ],
    seats: ['human-1', null, null, null, null, null, null, null, null],
    currentGameId: 'ROOM01',
  });
  await store.createGame({
    roomId: 'ROOM01',
    status: 'preflop',
    players: [
      { playerId: 'human-1', nickname: 'Old Name', avatar: '#111', seatPosition: 0, chips: 1000 },
    ],
  });

  const result = await playerManager.updateNickname('human-1', '  New Name  ');

  assert.equal(result.success, true);
  assert.equal(result.player.nickname, 'New Name');
  assert.equal((await store.getPlayer('human-1')).nickname, 'New Name');
  assert.equal((await store.getRoom('ROOM01')).players[0].nickname, 'New Name');
  assert.equal((await store.getGame('ROOM01')).players[0].nickname, 'New Name');
});

test('updating a nickname rejects blank names', async () => {
  await store.createPlayer({
    id: 'human-1',
    nickname: 'Old Name',
    avatar: '#111',
    chips: 1000,
  });

  const result = await playerManager.updateNickname('human-1', '   ');

  assert.equal(result.success, false);
  assert.match(result.error, /nickname/i);
});
