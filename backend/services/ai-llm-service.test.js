const test = require('node:test');
const assert = require('node:assert/strict');

const aiLlmService = require('./ai-llm-service');

function createDecisionState() {
  return {
    status: 'preflop',
    communityCards: [],
    currentBet: 20,
    minRaise: 20,
    totalPot: 30,
    legal_actions: {
      actions: ['fold', 'call', 'raise', 'allin'],
      to_call: 20,
      min_raise: 40,
      max_raise: 1000,
    },
    action_history: {
      preflop: [
        {
          seat_position: 1,
          player_name: 'Small Blind',
          action: 'small_blind',
          amount: 10,
          pot_after: 10,
        },
      ],
      flop: [],
      turn: [],
      river: [],
    },
    position_context: {
      dealer_position: 0,
      small_blind_position: 1,
      big_blind_position: 2,
      acting_order: [0, 1, 2],
      players_after_me: 2,
    },
    pot_odds: {
      pot_size: 30,
      to_call: 20,
      pot_odds: 0.4,
      effective_stack: 990,
      spr: 33,
    },
    players: [
      {
        playerId: 'bot-1',
        nickname: 'Bot-One',
        seatPosition: 0,
        chips: 1000,
        bet: 0,
        folded: false,
        holeCards: ['A♠', 'K♠'],
      },
    ],
  };
}

test('LLM prompt includes server-calculated poker decision context', () => {
  const state = createDecisionState();
  const prompt = aiLlmService._buildPrompt(state, state.players[0]);

  assert.match(prompt, /legal_actions/);
  assert.match(prompt, /action_history/);
  assert.match(prompt, /position_context/);
  assert.match(prompt, /pot_odds/);
  assert.match(prompt, /"to_call": 20/);
  assert.match(prompt, /"players_after_me": 2/);
  assert.match(prompt, /"spr": 33/);
});

test('LLM parser rejects actions outside legal_actions', () => {
  const state = createDecisionState();

  assert.throws(
    () => aiLlmService._parseDecision('{"action":"check","amount":0}', state, state.players[0]),
    /invalid action: check/
  );
});
