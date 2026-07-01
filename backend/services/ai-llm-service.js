/**
 * backend/services/ai-llm-service.js - LLM-based AI Decision Service
 *
 * Calls an OpenAI-compatible chat completions API to decide poker actions.
 * Falls back to rule-based AI when disabled, misconfigured, or on error.
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

const aiManager = require('./ai-manager');

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
    if (!this.isEnabled()) {
      return this._fallback(gameState, playerId, 'LLM not configured');
    }

    try {
      const player = gameState.players.find(p => p.playerId === playerId);
      if (!player) throw new Error('AI player not found in game state');

      const prompt = this._buildPrompt(gameState, player);
      const raw = await this._callLlm(prompt);
      const decision = this._parseDecision(raw, gameState, player);

      return {
        type: decision.action,
        amount: decision.amount,
        delayMs: this._randomDelay(),
        reason: decision.reason,
      };
    } catch (err) {
      console.error('[AI-LLM] Decision failed:', err.message);
      return this._fallback(gameState, playerId, err.message);
    }
  }

  /**
   * Call the configured LLM endpoint.
   */
  async _callLlm(prompt) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const response = await fetch(`${AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { role: 'system', content: this._systemPrompt() },
            { role: 'user', content: prompt },
          ],
          temperature: AI_TEMPERATURE,
          max_tokens: AI_MAX_TOKENS,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('LLM returned empty content');
      return content;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  _systemPrompt() {
    return `You are an expert Texas Hold'em poker player. You are playing as one of the bots.
Your job is to decide the best action based on the game state provided.
Respond ONLY with a JSON object in this exact format:
{
  "action": "fold|check|call|raise|allin",
  "amount": <number>,
  "reason": "<short reasoning in Chinese or English>"
}
Rules:
- Choose only from the server-provided legal_actions.actions list.
- "amount" is required for "raise" and represents the total chips you want to put in this round (must be at least current bet + minimum raise).
- For "raise", amount must be between legal_actions.min_raise and legal_actions.max_raise.
- For "fold", "check", "call", "allin", set amount to 0.
- If you don't have enough chips to call, choose "allin" or "fold".
- Be concise. Your response must be valid JSON only.`;
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

Decide your action. Return JSON only.`;
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
      parsed = JSON.parse(raw);
    } catch {
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
    // Use rule-based directly to avoid recursive LLM fallback
    const decision = aiManager.decideWithRules(gameState, playerId);
    return {
      type: decision.type,
      amount: decision.amount,
      delayMs: decision.delayMs,
      reason: `LLM fallback: ${reason}`,
    };
  }

  _randomDelay() {
    return AI_DELAY_MIN_MS + Math.floor(Math.random() * (AI_DELAY_MAX_MS - AI_DELAY_MIN_MS));
  }
}

module.exports = new AiLlmService();
