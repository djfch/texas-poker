const test = require('node:test');
const assert = require('node:assert/strict');

const gameEngine = require('./game-engine');
const store = require('../storage/memory-store');

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

test.afterEach(() => {
  resetStore();
});

async function createPlayer(id, seatPosition = id === 'human-1' ? 0 : 1) {
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

function createRoom(overrides = {}) {
  return {
    id: 'ROOM01',
    name: 'Private Deal Room',
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
    ...overrides,
  };
}

test('private deal payloads include two serializable hole cards for each seated player', async () => {
  resetStore();
  await createPlayer('human-1');
  await createPlayer('human-2');
  await store.createRoom(createRoom());

  const start = await gameEngine.startGame('ROOM01');
  assert.equal(start.success, true);

  const deals = await gameEngine.getPrivateDeals('ROOM01');

  assert.equal(deals.length, 2);
  assert.deepEqual(deals.map(d => d.position).sort(), [0, 1]);
  for (const deal of deals) {
    assert.equal(deal.cards.length, 2);
    assert.equal(typeof deal.cards[0].suit, 'string');
    assert.equal(typeof deal.cards[0].rank, 'string');
  }
});

test('AI decision context includes legal actions, action history, position and odds', async () => {
  resetStore();
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await createPlayer('bot-1', 2);
  await store.createRoom(createRoom({
    maxPlayers: 3,
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: false },
      { playerId: 'bot-1', nickname: 'Bot One', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: true },
    ],
    seats: ['human-1', 'human-2', 'bot-1', null, null, null, null, null, null],
  }));

  const start = await gameEngine.startGame('ROOM01');
  assert.equal(start.success, true);

  const context = await gameEngine.getAIDecisionContext('ROOM01', 'human-1');

  assert.deepEqual(context.legal_actions.actions, ['fold', 'call', 'raise', 'allin']);
  assert.equal(context.legal_actions.to_call, 20);
  assert.equal(context.legal_actions.min_raise, 40);
  assert.equal(context.legal_actions.max_raise, 1000);

  assert.equal(context.position_context.dealer_position, 0);
  assert.equal(context.position_context.small_blind_position, 1);
  assert.equal(context.position_context.big_blind_position, 2);
  assert.deepEqual(context.position_context.acting_order, [0, 1, 2]);
  assert.equal(context.position_context.players_after_me, 2);

  assert.equal(context.pot_odds.pot_size, 30);
  assert.equal(context.pot_odds.to_call, 20);
  assert.equal(context.pot_odds.pot_odds, 0.4);
  assert.equal(context.pot_odds.effective_stack, 990);
  assert.equal(context.pot_odds.spr, 33);

  assert.deepEqual(context.action_history.preflop.map(a => a.action), ['small_blind', 'big_blind']);
  assert.deepEqual(context.action_history.preflop.map(a => a.amount), [10, 20]);
  assert.deepEqual(context.action_history.preflop.map(a => a.pot_after), [10, 30]);
});

test('startGame rejects seated players without chips', async () => {
  resetStore();
  await createPlayer('human-1');
  await createPlayer('human-2');
  await store.createRoom(createRoom({
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 0, isAI: false },
    ],
  }));

  const result = await gameEngine.startGame('ROOM01');

  assert.equal(result.success, false);
  assert.match(result.error, /chips/i);
});

test('ended hands include winner seat position and nickname', async () => {
  resetStore();
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await store.createRoom(createRoom());

  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  const result = await gameEngine.handleAction('ROOM01', 'human-1', 'fold');

  assert.equal(result.success, true);
  assert.equal(result.game.status, 'ended');
  assert.deepEqual(result.game.winners, [
    {
      playerId: 'human-2',
      position: 1,
      nickname: 'Human Two',
      amount: 30,
      payout: 30,
      hand: 'All others folded',
    },
  ]);
});

test('all-in reveals every non-folded player hole cards in public game state', async () => {
  resetStore();
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await createPlayer('human-3', 2);
  await store.createRoom(createRoom({
    maxPlayers: 3,
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-3', nickname: 'Human Three', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
    ],
    seats: ['human-1', 'human-2', 'human-3', null, null, null, null, null, null],
  }));

  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  const beforeAllIn = await gameEngine.getGameState('ROOM01', null);
  assert.equal(beforeAllIn.players.every(p => p.holeCards === null), true);

  assert.equal((await gameEngine.handleAction('ROOM01', 'human-1', 'allin')).success, true);
  const afterAllIn = await gameEngine.getGameState('ROOM01', null);

  const livePlayers = afterAllIn.players.filter(p => !p.folded);
  assert.equal(livePlayers.length, 3);
  assert.equal(livePlayers.every(p => Array.isArray(p.holeCards) && p.holeCards.length === 2), true);
});

test('all-in action result includes revealed live player hole cards for socket broadcasts', async () => {
  resetStore();
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await createPlayer('human-3', 2);
  await store.createRoom(createRoom({
    maxPlayers: 3,
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-3', nickname: 'Human Three', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
    ],
    seats: ['human-1', 'human-2', 'human-3', null, null, null, null, null, null],
  }));

  assert.equal((await gameEngine.startGame('ROOM01')).success, true);

  const result = await gameEngine.handleAction('ROOM01', 'human-1', 'allin');

  assert.equal(result.success, true);
  assert.equal(
    result.game.players.filter(p => !p.folded).every(p => Array.isArray(p.holeCards) && p.holeCards.length === 2),
    true
  );
});

test('ended hands include every player hand result delta from the start of the hand', async () => {
  resetStore();
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await store.createRoom(createRoom());

  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  const result = await gameEngine.handleAction('ROOM01', 'human-1', 'fold');

  assert.equal(result.success, true);
  assert.deepEqual(result.game.handResults.map(r => ({
    playerId: r.playerId,
    position: r.position,
    nickname: r.nickname,
    chips: r.chips,
    delta: r.delta,
    isWinner: r.isWinner,
  })), [
    { playerId: 'human-1', position: 0, nickname: 'Human One', chips: 990, delta: -10, isWinner: false },
    { playerId: 'human-2', position: 1, nickname: 'Human Two', chips: 1010, delta: 10, isWinner: true },
  ]);
});

test('ended hands reset human readiness while AI players auto-ready for the next hand', async () => {
  resetStore();
  await createPlayer('human-1', 0);
  await createPlayer('bot-1', 1);
  await store.createRoom(createRoom({
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'bot-1', nickname: 'Bot One', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: true },
    ],
    seats: ['human-1', 'bot-1', null, null, null, null, null, null, null],
  }));

  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  assert.equal((await gameEngine.handleAction('ROOM01', 'human-1', 'fold')).success, true);

  const room = await store.getRoom('ROOM01');
  assert.equal(room.awaitingNextHandReady, true);
  assert.equal(room.players.find(p => p.playerId === 'human-1').isReady, false);
  assert.equal(room.players.find(p => p.playerId === 'bot-1').isReady, true);

  const storedHuman = await store.getPlayer('human-1');
  const storedBot = await store.getPlayer('bot-1');
  assert.equal(storedHuman.isReady, false);
  assert.equal(storedBot.isReady, true);
});

test('dealer and blinds rotate after a completed heads-up hand', async () => {
  resetStore();
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await store.createRoom(createRoom());

  const firstHand = await gameEngine.startGame('ROOM01');
  assert.equal(firstHand.success, true);
  assert.equal(firstHand.game.dealerPosition, 0);
  assert.equal(firstHand.game.smallBlindPos, 0);
  assert.equal(firstHand.game.bigBlindPos, 1);

  const endHand = await gameEngine.handleAction('ROOM01', 'human-1', 'fold');
  assert.equal(endHand.success, true);
  const roomAfterEnd = await store.getRoom('ROOM01');
  assert.equal(roomAfterEnd.status, 'waiting');
  assert.equal(roomAfterEnd.dealerPosition, 0);

  const secondHand = await gameEngine.startGame('ROOM01');

  assert.equal(secondHand.success, true);
  assert.equal(secondHand.game.dealerPosition, 1);
  assert.equal(secondHand.game.smallBlindPos, 1);
  assert.equal(secondHand.game.bigBlindPos, 0);
});

test('nextHand persists the completed game dealer for the next hand', async () => {
  resetStore();
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await store.createRoom(createRoom());

  const firstHand = await gameEngine.startGame('ROOM01');
  assert.equal(firstHand.success, true);

  const next = await gameEngine.nextHand('ROOM01');
  const room = await store.getRoom('ROOM01');

  assert.equal(next.success, true);
  assert.equal(room.dealerPosition, 0);
  assert.equal(await store.getGame('ROOM01'), null);
});

test('nextHand leaves broke seated players at zero chips until they borrow', async () => {
  resetStore();
  await createPlayer('human-1');
  await createPlayer('human-2');
  await store.createRoom(createRoom({
    status: 'playing',
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 0, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 2000, isAI: false },
    ],
  }));

  const result = await gameEngine.nextHand('ROOM01');

  assert.equal(result.success, true);
  assert.equal(result.room.players.find(p => p.playerId === 'human-1').chips, 0);
  assert.equal(result.room.status, 'waiting');
});

test('keeps action on the last player who still faces multiple all-ins', async () => {
  resetStore();
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await createPlayer('human-3', 2);
  await createPlayer('human-4', 3);
  await store.createRoom(createRoom({
    maxPlayers: 4,
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-3', nickname: 'Human Three', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-4', nickname: 'Human Four', avatar: '#444', seatPosition: 3, isReady: true, chips: 1000, isAI: false },
    ],
    seats: ['human-1', 'human-2', 'human-3', 'human-4', null, null, null, null, null],
  }));

  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  assert.equal((await gameEngine.handleAction('ROOM01', 'human-4', 'allin')).success, true);
  assert.equal((await gameEngine.handleAction('ROOM01', 'human-1', 'allin')).success, true);
  assert.equal((await gameEngine.handleAction('ROOM01', 'human-2', 'call')).success, true);

  const game = await gameEngine.getGameState('ROOM01', null);

  assert.equal(game.status, 'preflop');
  assert.equal(game.currentPosition, 2);
  assert.equal(game.currentPlayerId, 'human-3');
  assert.deepEqual(
    (await gameEngine.getValidActions('ROOM01', 'human-3')).map(action => action.type),
    ['fold', 'allin']
  );
});

test('invalid actions do not cancel the current turn timeout', async () => {
  resetStore();
  await createPlayer('human-1', 0);
  await createPlayer('human-2', 1);
  await createPlayer('human-3', 2);
  await store.createRoom(createRoom({
    maxPlayers: 3,
    players: [
      { playerId: 'human-1', nickname: 'Human One', avatar: '#111', seatPosition: 0, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-2', nickname: 'Human Two', avatar: '#222', seatPosition: 1, isReady: true, chips: 1000, isAI: false },
      { playerId: 'human-3', nickname: 'Human Three', avatar: '#333', seatPosition: 2, isReady: true, chips: 1000, isAI: false },
    ],
    seats: ['human-1', 'human-2', 'human-3', null, null, null, null, null, null],
  }));

  assert.equal((await gameEngine.startGame('ROOM01')).success, true);
  const before = await store.getGame('ROOM01');
  const timeoutId = before.timeoutId;

  const result = await gameEngine.handleAction('ROOM01', 'human-1', 'check');
  const after = await store.getGame('ROOM01');

  assert.equal(result.success, false);
  assert.equal(result.error, 'Cannot check, must call or raise');
  assert.equal(after.timeoutId, timeoutId);
  assert.equal(after.currentPosition, 0);
});
