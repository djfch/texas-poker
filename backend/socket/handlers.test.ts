const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const EVENTS = require('./events');
const gameEngine = require('../services/game-engine');
const store = require('../storage/memory-store');
const {
  setupSocketHandlers,
  _buildActionProgressEvents,
  _buildConnectedPayload,
  _maybeAutoStartNextHand,
  _scheduleTurnTimeout,
  _cancelTurnTimer,
} = require('./handlers');

function resetStore() {
  store.players.clear();
  store.rooms.clear();
  store.games.clear();
  store.sockets.clear();
  store.playerSockets.clear();
}

async function createPlayer(id: string, seatPosition: number, isAI = false) {
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
  const events: any[] = [];
  return {
    events,
    handlers: {} as Record<string, (...args: any[]) => any>,
    on(event: string, callback: (...args: any[]) => any) {
      this.handlers[event] = callback;
    },
    to(target: string) {
      return {
        emit(event: string, payload: any) {
          events.push({ target, event, payload });
        },
      };
    },
  };
}

function createSocketRecorder(id: string, playerId: string) {
  return {
    id,
    handshake: { query: { playerId } },
    handlers: {} as Record<string, (...args: any[]) => any>,
    joinedRooms: [] as string[],
    leftRooms: [] as string[],
    emitted: [] as any[],
    on(event: string, callback: (...args: any[]) => any) {
      this.handlers[event] = callback;
    },
    emit(event: string, payload: any) {
      this.emitted.push({ event, payload });
    },
    join(roomId: string) {
      this.joinedRooms.push(roomId);
    },
    leave(roomId: string) {
      this.leftRooms.push(roomId);
    },
  };
}

async function waitFor(predicate: () => any) {
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
  assert.ok(room.players.some((p: any) => p.playerId === 'human-1'));
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
    communityCards: ['A♠', 'K♥', '2♦'],
    pots: { mainPot: 40, sidePots: [] },
    totalPot: 40,
  };

  const events = _buildActionProgressEvents(
    beforeGame,
    afterGame,
    { position: 1, type: 'check', amount: undefined }
  );

  assert.deepEqual(events.map((e: any) => e.event), [
    EVENTS.SERVER.GAME_ACTION,
    EVENTS.SERVER.GAME_POT,
    EVENTS.SERVER.GAME_COMMUNITY,
  ]);
  assert.deepEqual(events[2].payload, {
    cards: ['A♠', 'K♥', '2♦'],
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
      { playerId: 'human-1', seatPosition: 0, folded: false, allIn: true, holeCards: ['A♠', 'K♥'] },
      { playerId: 'human-2', seatPosition: 1, folded: false, allIn: false, holeCards: ['Q♣', 'Q♦'] },
    ],
  };

  const events = _buildActionProgressEvents(
    beforeGame,
    afterGame,
    { position: 0, type: 'allin', amount: 1000 }
  );

  const showdown = events.find((item: any) => item.event === EVENTS.SERVER.GAME_SHOWDOWN);
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
    communityCards: ['2♠', '3♥', '4♦', '5♣', '9♠'],
    pots: { mainPot: 2000, sidePots: [] },
    totalPot: 2000,
    players: [
      { playerId: 'human-1', seatPosition: 0, folded: false, allIn: true, holeCards: ['A♠', 'K♥'] },
      { playerId: 'human-2', seatPosition: 1, folded: false, allIn: true, holeCards: ['Q♣', 'Q♦'] },
    ],
    showdownResults: [
      { position: 0, playerId: 'human-1', cards: ['A♠', 'K♥'], handName: '顺子' },
      { position: 1, playerId: 'human-2', cards: ['Q♣', 'Q♦'], handName: '一对' },
    ],
  };

  const events = _buildActionProgressEvents(
    beforeGame,
    afterGame,
    { position: 1, type: 'allin', amount: 1000 }
  );

  const showdown = events.find((item: any) => item.event === EVENTS.SERVER.GAME_SHOWDOWN);
  assert.deepEqual(showdown.payload, {
    results: [
      { position: 0, playerId: 'human-1', cards: ['A♠', 'K♥'], handName: '顺子' },
      { position: 1, playerId: 'human-2', cards: ['Q♣', 'Q♦'], handName: '一对' },
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

  const actionEvent = io.events.find((item: any) => item.event === EVENTS.SERVER.GAME_ACTION);
  assert.deepEqual(actionEvent.payload, {
    position: game.currentPosition,
    type: 'fold',
    amount: 0,
    reason: 'timeout',
  });

  const after = await gameEngine.getGameState('ROOM01', null);
  assert.equal(after.status, 'ended');
  assert.ok(after.players.find((p: any) => p.seatPosition === game.currentPosition).folded);
});

test('AI turn is broadcast before waiting for the LLM decision', async () => {
  const aiManager = require('../services/ai-manager');
  const originalDecide = aiManager.decide;
  const originalDecideWithRules = aiManager.decideWithRules;
  let resolveDecision: any;
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
      io.events.some((item: any) =>
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
  assert.ok(io.events.some((item: any) => item.event === EVENTS.SERVER.GAME_STARTED));
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
  const botRoomPlayer = room.players.find((p: any) => p.playerId === 'bot-1');
  assert.equal(started, true);
  assert.equal(room.status, 'playing');
  assert.equal(botRoomPlayer.buyInTotal, 2000);
  assert.equal(botRoomPlayer.borrowCount, 1);
  assert.equal(game.players.find((p: any) => p.playerId === 'bot-1').startingChips, 1000);
  assert.ok(io.events.some((item: any) => item.event === EVENTS.SERVER.GAME_STARTED));
});

test('failed action does not re-broadcast the current turn', async () => {
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await createPlayer('human-3', 2);
  await store.createRoom({
    ...createRoom(),
    maxPlayers: 3,
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-3', nickname: 'Human Three', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
    ],
    seats: ['human-1', 'human-2', 'human-3', null, null, null, null, null, null],
  });
  assert.equal((await gameEngine.startGame('ROOM01')).success, true);

  const io = createIoRecorder();
  const socket = createSocketRecorder('socket-1', 'human-1');
  setupSocketHandlers(io);
  io.handlers.connection(socket);
  await waitFor(() => socket.handlers[EVENTS.CLIENT.GAME_ACTION]);

  const turnEventsBefore = io.events.filter((item: any) => item.event === EVENTS.SERVER.GAME_TURN).length;
  await socket.handlers[EVENTS.CLIENT.GAME_ACTION]({ type: 'check', amount: 0 });

  // A rejected action must not re-broadcast the turn (re-broadcast is the only
  // path that re-arms the turn scheduler, see INV2 in handlers.ts).
  const turnEventsAfter = io.events.filter((item: any) => item.event === EVENTS.SERVER.GAME_TURN).length;
  assert.equal(turnEventsAfter, turnEventsBefore);
  assert.ok(socket.emitted.some((item: any) => item.event === EVENTS.SERVER.ERROR));
  const game = await store.getGame('ROOM01');
  assert.equal(game.currentPosition, 0);
});

test('request_state re-sends the private turn to the current player with the original timeout', async () => {
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await store.createRoom(createRoom());
  assert.equal((await gameEngine.startGame('ROOM01')).success, true);

  const game = await gameEngine.getGameState('ROOM01', null);
  const originalTimeoutAt = Date.now() + 30000;
  const io = createIoRecorder();
  await _scheduleTurnTimeout(io, 'ROOM01', {
    seatPosition: game.currentPosition,
    playerId: game.currentPlayerId,
  }, originalTimeoutAt);

  try {
    const socket = createSocketRecorder('socket-1', game.currentPlayerId);
    setupSocketHandlers(io);
    io.handlers.connection(socket);
    await waitFor(() => socket.handlers[EVENTS.CLIENT.REQUEST_STATE]);
    socket.emitted.length = 0;
    io.events.length = 0;

    await socket.handlers[EVENTS.CLIENT.REQUEST_STATE]();

    const turn = socket.emitted.find((item: any) => item.event === EVENTS.SERVER.GAME_TURN);
    assert.ok(turn, 'the current player must receive a private game:turn');
    assert.equal(turn.payload.position, game.currentPosition);
    assert.equal(turn.payload.timeoutAt, originalTimeoutAt, 'the original deadline must be reused');
    assert.ok(Array.isArray(turn.payload.validActions) && turn.payload.validActions.length > 0);
    assert.ok(
      !io.events.some((item: any) => item.event === EVENTS.SERVER.GAME_TURN),
      'the public turn must not be re-broadcast'
    );

    const gameState = socket.emitted.find((item: any) => item.event === EVENTS.SERVER.GAME_STATE);
    const self = gameState.payload.gameState.players.find((p: any) => p.playerId === game.currentPlayerId);
    const other = gameState.payload.gameState.players.find((p: any) => p.playerId !== game.currentPlayerId);
    assert.ok(Array.isArray(self.holeCards), 'the requester sees their own hole cards');
    assert.equal(other.holeCards, null, 'opponent hole cards must not leak');
  } finally {
    _cancelTurnTimer('ROOM01');
  }
});

test('request_state does not send a turn snapshot to a non-current player', async () => {
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await store.createRoom(createRoom());
  assert.equal((await gameEngine.startGame('ROOM01')).success, true);

  const game = await gameEngine.getGameState('ROOM01', null);
  const waitingPlayerId = game.players.find((p: any) => p.playerId !== game.currentPlayerId).playerId;
  const io = createIoRecorder();
  await _scheduleTurnTimeout(io, 'ROOM01', {
    seatPosition: game.currentPosition,
    playerId: game.currentPlayerId,
  }, Date.now() + 30000);

  try {
    const socket = createSocketRecorder('socket-2', waitingPlayerId);
    setupSocketHandlers(io);
    io.handlers.connection(socket);
    await waitFor(() => socket.handlers[EVENTS.CLIENT.REQUEST_STATE]);
    socket.emitted.length = 0;

    await socket.handlers[EVENTS.CLIENT.REQUEST_STATE]();

    assert.ok(socket.emitted.some((item: any) => item.event === EVENTS.SERVER.GAME_STATE));
    assert.ok(
      !socket.emitted.some((item: any) => item.event === EVENTS.SERVER.GAME_TURN),
      'a non-current player must not receive a turn snapshot'
    );
  } finally {
    _cancelTurnTimer('ROOM01');
  }
});

test('reconnecting on your turn restores the private turn snapshot with the original timeout', async () => {
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await store.createRoom(createRoom());
  assert.equal((await gameEngine.startGame('ROOM01')).success, true);

  const game = await gameEngine.getGameState('ROOM01', null);
  const originalTimeoutAt = Date.now() + 30000;
  const io = createIoRecorder();
  await _scheduleTurnTimeout(io, 'ROOM01', {
    seatPosition: game.currentPosition,
    playerId: game.currentPlayerId,
  }, originalTimeoutAt);

  try {
    const socket = createSocketRecorder('socket-3', game.currentPlayerId);
    setupSocketHandlers(io);
    io.handlers.connection(socket);
    await waitFor(() => socket.handlers[EVENTS.CLIENT.REQUEST_STATE]);

    const turn = socket.emitted.find((item: any) => item.event === EVENTS.SERVER.GAME_TURN);
    assert.ok(turn, 'reconnect must restore the private game:turn');
    assert.equal(turn.payload.position, game.currentPosition);
    assert.equal(turn.payload.timeoutAt, originalTimeoutAt);
    assert.ok(Array.isArray(turn.payload.validActions) && turn.payload.validActions.length > 0);
  } finally {
    _cancelTurnTimer('ROOM01');
  }
});

test('joining another room moves the socket out of the previous room', async () => {
  await createPlayer('human-1', -1);
  await createPlayer('other-host', -1);
  await store.createRoom({
    ...createRoom(),
    status: 'waiting',
    hostId: 'other-host',
    players: [
      { playerId: 'other-host', nickname: 'Other Host', avatar: '#999', seatPosition: -1, isReady: false, chips: 1000, isAI: false },
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: -1, isReady: false, chips: 1000, isAI: false },
    ],
    seats: [null, null, null, null, null, null, null, null, null],
    gameStartedAt: null,
  });
  await store.createRoom({
    ...createRoom(),
    id: 'ROOM02',
    status: 'waiting',
    hostId: 'human-1',
    players: [],
    seats: [null, null, null, null, null, null, null, null, null],
    gameStartedAt: null,
  });

  const io = createIoRecorder();
  const socket = createSocketRecorder('socket-4', 'human-1');
  setupSocketHandlers(io);
  io.handlers.connection(socket);
  await waitFor(() => socket.handlers[EVENTS.CLIENT.JOIN_ROOM]);
  assert.deepEqual(socket.leftRooms, []);

  await socket.handlers[EVENTS.CLIENT.JOIN_ROOM]({ roomId: 'ROOM02' });

  assert.ok(socket.joinedRooms.includes('ROOM02'));
  assert.deepEqual(socket.leftRooms, ['ROOM01'], 'the socket must leave the previous room');
  assert.equal((await store.getPlayer('human-1')).currentRoom, 'ROOM02');
  assert.ok(!(await store.getRoom('ROOM01')).players.some((p: any) => p.playerId === 'human-1'));
});

test('updating nickname does not broadcast a null-viewer game:state', async () => {
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await store.createRoom(createRoom());
  assert.equal((await gameEngine.startGame('ROOM01')).success, true);

  const io = createIoRecorder();
  const socket = createSocketRecorder('socket-5', 'human-1');
  setupSocketHandlers(io);
  io.handlers.connection(socket);
  await waitFor(() => socket.handlers[EVENTS.CLIENT.UPDATE_NICKNAME]);
  socket.emitted.length = 0;
  io.events.length = 0;

  await socket.handlers[EVENTS.CLIENT.UPDATE_NICKNAME]({ nickname: 'Renamed' });

  assert.ok(
    socket.emitted.some((item: any) => item.event === EVENTS.SERVER.PLAYER_UPDATED),
    'the requester still gets their player:updated'
  );
  assert.ok(
    io.events.some((item: any) => item.event === EVENTS.SERVER.PLAYER_UPDATED),
    'the room still gets player:updated'
  );
  assert.ok(
    io.events.some((item: any) => item.event === EVENTS.SERVER.ROOM_STATE),
    'room:state still refreshes nicknames'
  );
  assert.ok(
    !io.events.some((item: any) => item.event === EVENTS.SERVER.GAME_STATE)
      && !socket.emitted.some((item: any) => item.event === EVENTS.SERVER.GAME_STATE),
    'no game:state may be emitted after a rename'
  );
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
