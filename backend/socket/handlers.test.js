const test = require('node:test');
const assert = require('node:assert/strict');

const EVENTS = require('./events');
const gameEngine = require('../services/game-engine');
const store = require('../storage/memory-store');
const {
  setupSocketHandlers,
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

async function createPlayer(id, seatPosition, isAI = false) {
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
    handlers: {},
    on(event, callback) {
      this.handlers[event] = callback;
    },
    to(target) {
      return {
        emit(event, payload) {
          events.push({ target, event, payload });
        },
      };
    },
  };
}

function createSocketRecorder(id, playerId) {
  return {
    id,
    handshake: { query: { playerId } },
    handlers: {},
    joinedRooms: [],
    leftRooms: [],
    emitted: [],
    on(event, callback) {
      this.handlers[event] = callback;
    },
    emit(event, payload) {
      this.emitted.push({ event, payload });
    },
    join(roomId) {
      this.joinedRooms.push(roomId);
    },
    leave(roomId) {
      this.leftRooms.push(roomId);
    },
  };
}

async function waitFor(predicate) {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail('Timed out waiting for condition');
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

test('waiting-room transport close keeps the player in room during reconnect window', async () => {
  await createPlayer('human-1', 0);
  await store.createRoom({
    ...createRoom(),
    status: 'waiting',
    currentGameId: null,
    gameStartedAt: null,
  });
  const io = createIoRecorder();
  const socket = createSocketRecorder('socket-1', 'human-1');

  setupSocketHandlers(io);
  io.handlers.connection(socket);
  await waitFor(() => socket.handlers.disconnect);

  await socket.handlers.disconnect('transport close');

  const room = await store.getRoom('ROOM01');
  const player = await store.getPlayer('human-1');
  assert.ok(room);
  assert.ok(room.players.some(p => p.playerId === 'human-1'));
  assert.equal(player.currentRoom, 'ROOM01');
  assert.equal(player.isOnline, false);
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

test('action progress events do not reveal cards just because a payload contains hole cards', () => {
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
      { playerId: 'human-1', seatPosition: 0, folded: false, allIn: true, holeCards: ['A\u2660', 'K\u2665'] },
      { playerId: 'human-2', seatPosition: 1, folded: false, allIn: false, holeCards: ['Q\u2663', 'Q\u2666'] },
    ],
  };

  const events = _buildActionProgressEvents(
    beforeGame,
    afterGame,
    { position: 0, type: 'allin', amount: 1000 }
  );

  const showdown = events.find(item => item.event === EVENTS.SERVER.GAME_SHOWDOWN);
  assert.equal(showdown, undefined);
});

test('action progress events reveal live player cards when betting is over at showdown', () => {
  const beforeGame = {
    status: 'preflop',
    communityCards: [],
    players: [
      { playerId: 'human-1', seatPosition: 0, folded: false, holeCards: null },
      { playerId: 'human-2', seatPosition: 1, folded: false, holeCards: null },
    ],
  };
  const afterGame = {
    status: 'ended',
    communityCards: ['2\u2660', '3\u2665', '4\u2666', '5\u2663', '9\u2660'],
    pots: { mainPot: 2000, sidePots: [] },
    totalPot: 2000,
    players: [
      { playerId: 'human-1', seatPosition: 0, folded: false, allIn: true, holeCards: ['A\u2660', 'K\u2665'] },
      { playerId: 'human-2', seatPosition: 1, folded: false, allIn: true, holeCards: ['Q\u2663', 'Q\u2666'] },
    ],
    showdownResults: [
      { position: 0, playerId: 'human-1', cards: ['A\u2660', 'K\u2665'], handName: '顺子' },
      { position: 1, playerId: 'human-2', cards: ['Q\u2663', 'Q\u2666'], handName: '一对' },
    ],
  };

  const events = _buildActionProgressEvents(
    beforeGame,
    afterGame,
    { position: 1, type: 'allin', amount: 1000 }
  );

  const showdown = events.find(item => item.event === EVENTS.SERVER.GAME_SHOWDOWN);
  assert.deepEqual(showdown.payload, {
    results: [
      { position: 0, playerId: 'human-1', cards: ['A\u2660', 'K\u2665'], handName: '顺子' },
      { position: 1, playerId: 'human-2', cards: ['Q\u2663', 'Q\u2666'], handName: '一对' },
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

test('AI turn is broadcast before waiting for the LLM decision', async () => {
  const aiManager = require('../services/ai-manager');
  const originalDecide = aiManager.decide;
  const originalDecideWithRules = aiManager.decideWithRules;
  let resolveDecision;
  const slowDecision = new Promise(resolve => {
    resolveDecision = () => resolve({
      type: 'check',
      amount: 0,
      delayMs: 0,
      reason: 'diagnostic delay',
    });
  });

  try {
    await createPlayer('human-1', 0);
    await createPlayer('bot-1', 1, true);
    await createPlayer('human-2', 2);
    await store.createRoom({
      ...createRoom(),
      maxPlayers: 3,
      players: [
        { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
        { playerId: 'bot-1', nickname: 'Bot One', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: true },
        { playerId: 'human-2', nickname: 'Human Two', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
      ],
      seats: ['human-1', 'bot-1', 'human-2', null, null, null, null, null, null],
    });
    const start = await gameEngine.startGame('ROOM01');
    assert.equal(start.success, true);

    const liveGame = await store.getGame('ROOM01');
    if (liveGame.timeoutId) {
      clearTimeout(liveGame.timeoutId);
      liveGame.timeoutId = null;
    }
    liveGame.status = 'flop';
    liveGame.currentPosition = 0;
    liveGame.currentBet = 0;
    liveGame.minRaise = 20;
    liveGame.actionsTaken.clear();
    for (const player of liveGame.players) {
      player.bet = 0;
    }

    aiManager.decide = async () => slowDecision;
    aiManager.decideWithRules = aiManager.decide;

    const io = createIoRecorder();
    const socket = createSocketRecorder('socket-1', 'human-1');
    setupSocketHandlers(io);
    io.handlers.connection(socket);
    await waitFor(() => socket.handlers[EVENTS.CLIENT.GAME_ACTION]);

    const actionPromise = socket.handlers[EVENTS.CLIENT.GAME_ACTION]({ type: 'check', amount: 0 });
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.ok(
      io.events.some(item =>
        item.event === EVENTS.SERVER.GAME_TURN && item.payload.position === 1
      ),
      'expected the AI turn to be broadcast before the delayed AI decision resolves'
    );

    resolveDecision();
    await actionPromise;
    await new Promise(resolve => setTimeout(resolve, 0));
  } finally {
    if (resolveDecision) resolveDecision();
    aiManager.decide = originalDecide;
    aiManager.decideWithRules = originalDecideWithRules;
  }
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

test('next hand auto-start lends one initial stack to broke seated AI', async () => {
  await createPlayer('human-1', 0);
  await createPlayer('bot-1', 1);
  await store.createRoom({
    ...createRoom(),
    status: 'waiting',
    currentGameId: null,
    awaitingNextHandReady: true,
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, buyInTotal: 1000, borrowCount: 0, isAI: false },
      { playerId: 'bot-1', nickname: 'Bot One', avatar: '#222', seatPosition: 1, isReady: false, chips: 0, buyInTotal: 1000, borrowCount: 0, isAI: true },
    ],
    seats: ['human-1', 'bot-1', null, null, null, null, null, null, null],
  });
  const io = createIoRecorder();

  const started = await _maybeAutoStartNextHand(io, 'ROOM01');

  const room = await store.getRoom('ROOM01');
  const game = await store.getGame('ROOM01');
  const botRoomPlayer = room.players.find(p => p.playerId === 'bot-1');
  assert.equal(started, true);
  assert.equal(room.status, 'playing');
  assert.equal(botRoomPlayer.buyInTotal, 2000);
  assert.equal(botRoomPlayer.borrowCount, 1);
  assert.equal(game.players.find(p => p.playerId === 'bot-1').startingChips, 1000);
  assert.ok(io.events.some(item => item.event === EVENTS.SERVER.GAME_STARTED));
});
