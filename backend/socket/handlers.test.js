const test = require('node:test');
const assert = require('node:assert/strict');

const EVENTS = require('./events');
const { _buildActionProgressEvents } = require('./handlers');

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
