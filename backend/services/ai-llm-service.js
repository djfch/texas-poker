/**
 * backend/services/ai-llm-service.js - LLM-based AI Decision Service
 *
 * Calls an OpenAI-compatible chat completions API to decide poker actions.
 * Falls back to rule-based AI when disabled or misconfigured.
 * When the configured LLM keeps returning unusable decisions, the bot folds.
 */

const {
  AI_PROVIDER,
  AI_BASE_URL,
  AI_API_KEY,
  AI_MODEL,
  AI_TIMEOUT_MS,
  AI_TEMPERATURE,
  AI_MAX_TOKENS,
  AI_FALLBACK_ENABLED,
  AI_DELAY_MIN_MS,
  AI_DELAY_MAX_MS,
} = require('../config/constants');

const aiRuleEngine = require('./ai-rule-engine');

const JSON_OUTPUT_MIN_TOKENS = 4096;
const JSON_DECISION_MAX_RETRIES = 2;

class AiLlmService {
  isEnabled() {
    return Boolean(AI_API_KEY) && AI_API_KEY.length > 10 && AI_API_KEY !== 'sk-your-api-key-here';
  }

  /**
   * Decide an action for the AI player.
   * @param {object} gameState - Sanitized game state from the AI player's perspective
   *                             (must include AI's own hole cards).
   * @param {string} playerId
   * @returns {Promise<{type: string, amount?: number, delayMs: number, reason?: string}>}
   */
  async decide(gameState, playerId) {
    let player = null;
    if (!this.isEnabled()) {
      return this._fallback(gameState, playerId, 'LLM not configured');
    }

    try {
      player = gameState.players.find(p => p.playerId === playerId);
      if (!player) throw new Error('AI player not found in game state');

      const prompt = this._buildPrompt(gameState, player);
      const decision = await this._requestParsedDecision(prompt, gameState, player);

      return {
        type: decision.action,
        amount: decision.amount,
        delayMs: this._randomDelay(),
        reason: decision.reason,
      };
    } catch (err) {
      console.error(this._formatLogMessage(
        `Decision failed for ${this._playerLabel(player, gameState, playerId)}: ${err.message}`
      ));
      return this._foldAfterLlmFailure(err);
    }
  }

  /**
   * Call the configured LLM endpoint.
   */
  async _callLlm(prompt) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._requestTimeoutMs());

    try {
      const response = await fetch(`${AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify(this._buildRequestBody(prompt)),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0] || {};
      return {
        content: choice.message?.content || '',
        finishReason: choice.finish_reason || null,
        reasoningContent: choice.message?.reasoning_content || '',
        usage: data.usage || null,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  _buildRequestBody(prompt, overrides = {}) {
    const model = overrides.model || AI_MODEL;
    const body = {
      model,
      messages: [
        { role: 'system', content: this._systemPrompt() },
        { role: 'user', content: prompt },
      ],
      temperature: AI_TEMPERATURE,
      max_tokens: Math.max(AI_MAX_TOKENS, JSON_OUTPUT_MIN_TOKENS),
      response_format: { type: 'json_object' },
      thinking: { type: 'enabled' },
      stream: false,
    };

    return body;
  }

  _requestTimeoutMs() {
    return AI_TIMEOUT_MS;
  }

  _systemPrompt() {
    return `You are an expert Texas Hold'em poker player. You are playing as one of the bots.
Your job is to decide the best action based on the game state provided.
Respond ONLY with one complete valid minified json object. Do not use markdown, code fences, comments, trailing commas, or extra text.
Example valid json output:
{"action":"call","amount":0,"reason":"底池赔率合适"}
Rules:
- Choose only from the server-provided legal_actions.actions list.
- The json object must contain exactly these keys: action, amount, reason.
- "action" must be one of: "fold", "check", "call", "raise", "allin".
- "amount" must be a number.
- "reason" must be a short Chinese string. The final returned json object's reason field must be written in 中文.
- "amount" is required for "raise" and represents the total chips you want to put in this round (must be at least current bet + minimum raise).
- For "raise", amount must be between legal_actions.min_raise and legal_actions.max_raise.
- For "fold", "check", "call", "allin", set amount to 0.
- If you don't have enough chips to call, choose "allin" or "fold".
- Be concise. Your response must be valid json only.`;
  }

  _buildPrompt(gameState, player) {
    const round = gameState.status;
    const community = (gameState.communityCards || []).join(' ') || 'none';
    const hole = (player.holeCards || []).join(' ') || 'unknown';
    const toCall = Math.max(0, gameState.currentBet - (player.bet || 0));

    const decisionContext = {
      legal_actions: gameState.legal_actions || {},
      action_history: gameState.action_history || this._emptyActionHistory(),
      position_context: gameState.position_context || {},
      pot_odds: gameState.pot_odds || {},
    };

    return `Current round: ${round}
Community cards: ${community}
Your seat: ${player.seatPosition}
Your hole cards: ${hole}
Your chips: ${player.chips}
Your current bet this round: ${player.bet || 0}
Current table bet to call: ${gameState.currentBet}
Amount you need to call: ${toCall}
Minimum raise total: ${gameState.currentBet + gameState.minRaise}
Total pot: ${gameState.totalPot}
Players still in hand: ${gameState.players.filter(p => !p.folded).length}
Your style: ${player.aiStyle || 'balanced'}

Server-calculated decision context:
${JSON.stringify(decisionContext, null, 2)}

Decide your action. Return one complete valid minified json object only.`;
  }

  _emptyActionHistory() {
    return {
      preflop: [],
      flop: [],
      turn: [],
      river: [],
    };
  }

  _parseDecision(raw, gameState, player) {
    let parsed;
    try {
      parsed = JSON.parse(this._extractJsonObject(raw));
    } catch (err) {
      if (err.message === 'LLM returned empty content') throw err;
      throw new Error('LLM response is not valid JSON');
    }

    let action = String(parsed.action || '').toLowerCase().trim();
    const amount = Number(parsed.amount) || 0;

    // Normalize "bet" to "raise" since the engine uses raise uniformly
    if (action === 'bet') {
      action = 'raise';
      parsed.action = 'raise';
    }

    const legal = gameState.legal_actions || {};
    const validActions = Array.isArray(legal.actions) && legal.actions.length
      ? legal.actions
      : ['fold', 'check', 'call', 'raise', 'allin'];

    if (!validActions.includes(action)) {
      throw new Error(`LLM returned invalid action: ${action}`);
    }

    const toCall = legal.to_call ?? Math.max(0, gameState.currentBet - (player.bet || 0));

    // Validate against game rules
    if (action === 'check' && toCall > 0) {
      throw new Error('LLM tried to check when a call is required');
    }
    if (action === 'call' && player.chips < toCall) {
      // Convert to all-in if short stacked
      parsed.action = 'allin';
      parsed.amount = 0;
    }
    if (['raise', 'bet'].includes(action)) {
      const minTotal = legal.min_raise ?? (gameState.currentBet + gameState.minRaise);
      const maxTotal = legal.max_raise ?? (player.chips + (player.bet || 0));
      if (amount < minTotal && amount < maxTotal) {
        throw new Error(`LLM raise amount ${amount} below minimum ${minTotal}`);
      }
      if (amount > maxTotal) {
        throw new Error(`LLM raise amount ${amount} exceeds available chips`);
      }
      if (amount >= maxTotal) {
        parsed.action = 'allin';
        parsed.amount = 0;
      }
    }
    if (action === 'allin') {
      parsed.amount = 0;
    }

    return {
      action: parsed.action,
      amount: parsed.amount || 0,
      reason: String(parsed.reason || '').slice(0, 100),
    };
  }

  _fallback(gameState, playerId, reason) {
    if (!AI_FALLBACK_ENABLED) {
      return { type: 'fold', amount: 0, delayMs: this._randomDelay(), reason };
    }
    const decision = aiRuleEngine.decide(gameState, playerId);
    return {
      type: decision.type,
      amount: decision.amount,
      delayMs: decision.delayMs,
      reason: `LLM fallback: ${reason}`,
    };
  }

  _foldAfterLlmFailure(err) {
    const attempts = err.aiDecisionAttempts || JSON_DECISION_MAX_RETRIES + 1;
    return {
      type: 'fold',
      amount: 0,
      delayMs: this._randomDelay(),
      reason: `LLM failed after ${attempts} attempts: ${err.message}`,
    };
  }

  _randomDelay() {
    return AI_DELAY_MIN_MS + Math.floor(Math.random() * (AI_DELAY_MAX_MS - AI_DELAY_MIN_MS));
  }

  _extractJsonObject(raw) {
    const text = String(raw ?? '').trim();
    if (!text) throw new Error('LLM returned empty content');

    try {
      JSON.parse(text);
      return text;
    } catch {
      // Continue with tolerant extraction below.
    }

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return fenced[1].trim();
    }

    const start = text.indexOf('{');
    if (start === -1) return text;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    return text;
  }

  async _requestParsedDecision(prompt, gameState, player) {
    let lastError = null;
    let requestPrompt = prompt;

    for (let attempt = 0; attempt <= JSON_DECISION_MAX_RETRIES; attempt++) {
      let result = null;

      try {
        result = this._normalizeLlmResult(await this._callLlm(requestPrompt));
        this._logRawResponse(player, result);
        return this._parseDecision(result.content, gameState, player);
      } catch (err) {
        lastError = err;
        err.aiDecisionAttempts = attempt + 1;
        if (attempt >= JSON_DECISION_MAX_RETRIES || !this._shouldRetryDecision(err, result)) {
          throw err;
        }
        const finishReason = result?.finishReason;
        console.warn(this._formatLogMessage(
          `Retrying decision for ${this._playerLabel(player)} ` +
          `(${attempt + 2}/${JSON_DECISION_MAX_RETRIES + 1}) after ${err.message}` +
          (finishReason ? ` (finish_reason=${finishReason})` : '')
        ));
        requestPrompt = this._buildRetryPrompt(prompt, err, result || {});
      }
    }

    throw lastError || new Error('LLM response is not valid JSON');
  }

  _normalizeLlmResult(result) {
    if (typeof result === 'string') {
      return { content: result, finishReason: null, reasoningContent: '', usage: null };
    }
    return {
      content: String(result?.content ?? ''),
      finishReason: result?.finishReason || null,
      reasoningContent: result?.reasoningContent || '',
      usage: result?.usage || null,
    };
  }

  _shouldRetryDecision(_err, _result) {
    return true;
  }

  _buildRetryPrompt(prompt, err, result = {}) {
    return `${prompt}

The previous model output was invalid for this reason: ${err.message}${result.finishReason ? `, finish_reason=${result.finishReason}` : ''}.
Return ONLY one complete minified valid json object in this exact shape:
{"action":"fold","amount":0,"reason":"理由必须为中文"}`;
  }

  _logRawResponse(player, rawResult) {
    const result = this._normalizeLlmResult(rawResult);
    const finish = result.finishReason ? ` finish_reason=${result.finishReason}` : '';
    console.log(
      this._formatLogMessage(
        `Raw response for ${this._playerLabel(player)} (${AI_PROVIDER}/${AI_MODEL})${finish}: ${result.content}`
      )
    );
  }

  _formatLogMessage(message) {
    return `[${new Date().toISOString()}] [AI-LLM] ${message}`;
  }

  _playerLabel(player, gameState = null, playerId = null) {
    const resolved = player || gameState?.players?.find(p => p.playerId === playerId);
    return resolved?.nickname || resolved?.playerId || playerId || 'unknown-ai';
  }

}

module.exports = new AiLlmService();
