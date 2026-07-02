const test = require('node:test');
const assert = require('node:assert/strict');

const aiLlmService = require('./ai-llm-service');

function clearAIModuleCache() {
  for (const modulePath of ['./ai-manager', './ai-llm-service', './ai-rule-engine']) {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch {
      // Module may not exist yet while writing the failing regression test.
    }
  }
}

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

test('LLM parser accepts a JSON object inside a markdown code block', () => {
  const state = createDecisionState();

  const decision = aiLlmService._parseDecision(
    '```json\n{"action":"call","amount":0,"reason":"pot odds"}\n```',
    state,
    state.players[0]
  );

  assert.deepEqual(decision, {
    action: 'call',
    amount: 0,
    reason: 'pot odds',
  });
});

test('LLM request body follows DeepSeek JSON output requirements', () => {
  const prompt = 'Return json only.';
  const body = aiLlmService._buildRequestBody(prompt, {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  });

  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.thinking.type, 'disabled');
  assert.ok(body.max_tokens >= 512);
  assert.match(body.messages[0].content, /json/);
  assert.match(body.messages[0].content, /\{"action":"call","amount":0,"reason":"[^"]+"\}/);
});

test('LLM decision retries twice before returning a valid JSON decision', async () => {
  const state = createDecisionState();
  const originalEnabled = aiLlmService.isEnabled;
  const originalCall = aiLlmService._callLlm;
  const originalLog = console.log;
  const originalWarn = console.warn;
  let calls = 0;

  try {
    aiLlmService.isEnabled = () => true;
    aiLlmService._callLlm = async () => {
      calls += 1;
      return calls < 3
        ? { content: '{"action":"fold",', finishReason: 'length' }
        : { content: '{"action":"call","amount":0,"reason":"retry ok"}', finishReason: 'stop' };
    };
    console.log = () => {};
    console.warn = () => {};

    const decision = await aiLlmService.decide(state, 'bot-1');

    assert.equal(calls, 3);
    assert.equal(decision.type, 'call');
    assert.equal(decision.reason, 'retry ok');
  } finally {
    aiLlmService.isEnabled = originalEnabled;
    aiLlmService._callLlm = originalCall;
    console.log = originalLog;
    console.warn = originalWarn;
  }
});

test('LLM decision folds after three failed AI responses', async () => {
  const state = createDecisionState();
  const originalEnabled = aiLlmService.isEnabled;
  const originalCall = aiLlmService._callLlm;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  let calls = 0;
  const errors = [];

  try {
    aiLlmService.isEnabled = () => true;
    aiLlmService._callLlm = async () => {
      calls += 1;
      return { content: '{"action":"fold",', finishReason: 'length' };
    };
    console.log = () => {};
    console.warn = () => {};
    console.error = (...args) => errors.push(args.join(' '));

    const decision = await aiLlmService.decide(state, 'bot-1');

    assert.equal(calls, 3);
    assert.equal(decision.type, 'fold');
    assert.equal(decision.amount, 0);
    assert.match(decision.reason, /LLM failed after 3 attempts/);
    assert.ok(errors.some(line => line.includes('Bot-One')));
  } finally {
    aiLlmService.isEnabled = originalEnabled;
    aiLlmService._callLlm = originalCall;
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test('LLM raw response log includes the AI player name and returned content', async () => {
  const state = createDecisionState();
  const originalEnabled = aiLlmService.isEnabled;
  const originalCall = aiLlmService._callLlm;
  const originalLog = console.log;
  const logs = [];

  try {
    aiLlmService.isEnabled = () => true;
    aiLlmService._callLlm = async () => ({ content: '{"action":"call","amount":0,"reason":"test"}', finishReason: 'stop' });
    console.log = (...args) => logs.push(args.join(' '));

    const decision = await aiLlmService.decide(state, 'bot-1');

    assert.equal(decision.type, 'call');
    assert.ok(logs.some(line => line.includes('Bot-One') && line.includes('"action":"call"')));
  } finally {
    aiLlmService.isEnabled = originalEnabled;
    aiLlmService._callLlm = originalCall;
    console.log = originalLog;
  }
});

test('AI manager handles LLM failure without circular rule fallback dependency', async () => {
  clearAIModuleCache();
  const aiManager = require('./ai-manager');
  const llmServiceFromManagerPath = require('./ai-llm-service');
  const state = createDecisionState();
  const originalEnabled = llmServiceFromManagerPath.isEnabled;
  const originalCall = llmServiceFromManagerPath._callLlm;
  const originalError = console.error;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const errors = [];

  try {
    llmServiceFromManagerPath.isEnabled = () => true;
    llmServiceFromManagerPath._callLlm = async () => ({ content: 'not json', finishReason: 'stop' });
    console.error = (...args) => errors.push(args.join(' '));
    console.log = () => {};
    console.warn = () => {};

    const decision = await aiManager.decide(state, 'bot-1');

    assert.ok(state.legal_actions.actions.includes(decision.type));
    assert.equal(errors.some(line => line.includes('decideWithRules is not a function')), false);
  } finally {
    llmServiceFromManagerPath.isEnabled = originalEnabled;
    llmServiceFromManagerPath._callLlm = originalCall;
    console.error = originalError;
    console.log = originalLog;
    console.warn = originalWarn;
    clearAIModuleCache();
  }
});
