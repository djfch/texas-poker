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
