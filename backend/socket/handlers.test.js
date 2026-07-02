const test = require('node:test');
const assert = require('node:assert/strict');

const EVENTS = require('./events');
const gameEngine = require('../services/game-engine');
const store = require('../storage/memory-store');
const {
  _buildActionProgressEvents,
  _buildConnectedPayload,
  _maybeAutoStartNextHand,
  _scheduleTurnTimeout,
} = require('./handlers');

function resetStore() {
  for (const game of store.games.values()) {
    if (game.timeoutId) clearTimeout(game.timeoutId);
  }
  store.players.clear();
  store.rooms.clear();
  store.games.clear();
  store.sockets.clear();
  store.playerSockets.clear();
}

async function createPlayer(id, seatPosition) {
  const player = {
    id,
    nickname: id,
    avatar: '#2ecc71',
    chips: 1000,
    isGuest: true,
    isOnline: true,
    currentRoom: 'ROOM01',
    seatPosition,
  };
  await store.createPlayer(player);
  return player;
}

function createRoom() {
  return {
    id: 'ROOM01',
    name: 'Timeout Room',
    hostId: 'human-1',
    maxPlayers: 2,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: true,
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
  };
}

function createIoRecorder() {
  const events = [];
  return {
    events,
    to(target) {
      return {
        emit(event, payload) {
          events.push({ target, event, payload });
        },
      };
    },
  };
}

test.afterEach(() => {
  resetStore();
});

test('connected payload includes the socket-bound player profile', () => {
  const payload = _buildConnectedPayload({
    id: 'player-1',
    nickname: 'SocketHost_1',
    avatar: '#123456',
    chips: 1000,
    socketId: 'socket-1',
    currentRoom: 'ROOM01',
  });

  assert.deepEqual(payload, {
    playerId: 'player-1',
    player: {
      id: 'player-1',
      nickname: 'SocketHost_1',
      avatar: '#123456',
      chips: 1000,
    },
  });
});

test('action progress events include community cards when an AI action advances to the flop', () => {
  const beforeGame = {
    status: 'preflop',
    communityCards: [],
  };
  const afterGame = {
    status: 'flop',
    communityCards: ['A\u2660', 'K\u2665', '2\u2666'],
    pots: { mainPot: 40, sidePots: [] },
    totalPot: 40,
  };

  const events = _buildActionProgressEvents(
    beforeGame,
    afterGame,
    { position: 1, type: 'check', amount: undefined }
  );

  assert.deepEqual(events.map(e => e.event), [
    EVENTS.SERVER.GAME_ACTION,
    EVENTS.SERVER.GAME_POT,
    EVENTS.SERVER.GAME_COMMUNITY,
  ]);
  assert.deepEqual(events[2].payload, {
    cards: ['A\u2660', 'K\u2665', '2\u2666'],
    round: 'flop',
  });
});

test('pot event includes current player bets for table chip records', () => {
  const beforeGame = {
    status: 'preflop',
    communityCards: [],
  };
  const afterGame = {
    status: 'preflop',
    communityCards: [],
    pots: { mainPot: 60, sidePots: [] },
    totalPot: 60,
    players: [
      { playerId: 'human-1', seatPosition: 0, chips: 980, bet: 20, totalBet: 20, allIn: false },
      { playerId: 'human-2', seatPosition: 1, chips: 980, bet: 20, totalBet: 20, allIn: false },
      { playerId: 'human-3', seatPosition: 2, chips: 980, bet: 20, totalBet: 20, allIn: true },
    ],
  };

  const events = _buildActionProgressEvents(
    beforeGame,
    afterGame,
    { position: 0, type: 'call', amount: 20 }
  );

  assert.deepEqual(events[1].payload.players, [
    { playerId: 'human-1', position: 0, chips: 980, bet: 20, totalBet: 20, allIn: false },
    { playerId: 'human-2', position: 1, chips: 980, bet: 20, totalBet: 20, allIn: false },
    { playerId: 'human-3', position: 2, chips: 980, bet: 20, totalBet: 20, allIn: true },
  ]);
});

test('action progress events reveal live player cards when an all-in starts public reveal', () => {
  const beforeGame = {
    status: 'preflop',
    communityCards: [],
    players: [
      { playerId: 'human-1', seatPosition: 0, folded: false, holeCards: null },
      { playerId: 'human-2', seatPosition: 1, folded: false, holeCards: null },
    ],
  };
  const afterGame = {
    status: 'preflop',
    communityCards: [],
    pots: { mainPot: 1030, sidePots: [] },
    totalPot: 1030,
    players: [
      { playerId: 'human-1', seatPosition: 0, folded: false, holeCards: ['A\u2660', 'K\u2665'] },
      { playerId: 'human-2', seatPosition: 1, folded: false, holeCards: ['Q\u2663', 'Q\u2666'] },
    ],
  };

  const events = _buildActionProgressEvents(
    beforeGame,
    afterGame,
    { position: 0, type: 'allin', amount: 1000 }
  );

  const showdown = events.find(item => item.event === EVENTS.SERVER.GAME_SHOWDOWN);
  assert.deepEqual(showdown.payload, {
    results: [
      { position: 0, playerId: 'human-1', cards: ['A\u2660', 'K\u2665'], handName: null },
      { position: 1, playerId: 'human-2', cards: ['Q\u2663', 'Q\u2666'], handName: null },
    ],
  });
});

test('scheduled turn timeout auto-folds the current player and broadcasts the action', async () => {
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await store.createRoom(createRoom());
  const start = await gameEngine.startGame('ROOM01');
  assert.equal(start.success, true);

  const game = await gameEngine.getGameState('ROOM01', null);
  const io = createIoRecorder();

  await _scheduleTurnTimeout(io, 'ROOM01', {
    seatPosition: game.currentPosition,
    playerId: game.currentPlayerId,
  }, Date.now() - 1);

  await new Promise(resolve => setTimeout(resolve, 10));

  const actionEvent = io.events.find(item => item.event === EVENTS.SERVER.GAME_ACTION);
  assert.deepEqual(actionEvent.payload, {
    position: game.currentPosition,
    type: 'fold',
    amount: 0,
    reason: 'timeout',
  });

  const after = await gameEngine.getGameState('ROOM01', null);
  assert.equal(after.status, 'ended');
  assert.ok(after.players.find(p => p.seatPosition === game.currentPosition).folded);
});

test('next hand auto-starts when every seated player is ready', async () => {
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await store.createRoom({
    ...createRoom(),
    status: 'waiting',
    currentGameId: null,
    awaitingNextHandReady: true,
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: false },
    ],
  });
  const io = createIoRecorder();

  const started = await _maybeAutoStartNextHand(io, 'ROOM01');

  const room = await store.getRoom('ROOM01');
  const game = await store.getGame('ROOM01');
  assert.equal(started, true);
  assert.equal(room.status, 'playing');
  assert.equal(room.awaitingNextHandReady, false);
  assert.equal(game.status, 'preflop');
  assert.ok(io.events.some(item => item.event === EVENTS.SERVER.GAME_STARTED));
});
