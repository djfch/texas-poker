const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

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

test('updating a nickname persists through the storage contract (copy-returning backend)', async () => {
  // Reproduce postgres/redis semantics: getters hand out detached copies, so
  // mutating the fetched record only sticks if updateNickname writes it back.
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

  const realGetPlayer = store.getPlayer.bind(store);
  const realGetRoom = store.getRoom.bind(store);
  const realGetGame = store.getGame.bind(store);
  store.getPlayer = async (id: string) => {
    const p = await realGetPlayer(id);
    return p ? structuredClone(p) : p;
  };
  store.getRoom = async (id: string) => {
    const r = await realGetRoom(id);
    return r ? structuredClone(r) : r;
  };
  store.getGame = async (id: string) => {
    const g = await realGetGame(id);
    return g ? structuredClone(g) : g;
  };

  try {
    const result = await playerManager.updateNickname('human-1', 'New Name');
    assert.equal(result.success, true);
  } finally {
    store.getPlayer = realGetPlayer;
    store.getRoom = realGetRoom;
    store.getGame = realGetGame;
  }

  // Canonical (non-cloned) records must reflect the new nickname.
  assert.equal((await realGetPlayer('human-1')).nickname, 'New Name');
  assert.equal((await realGetRoom('ROOM01')).players[0].nickname, 'New Name');
  assert.equal((await realGetGame('ROOM01')).players[0].nickname, 'New Name');
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
