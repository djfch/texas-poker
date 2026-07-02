/**
 * backend/services/ai-rule-engine.js - rule-based AI decision fallback
 *
 * Kept independent from ai-manager and ai-llm-service to avoid circular imports.
 */

const { HandEvaluator } = require('../domain/hand-evaluator');
const { Card } = require('../domain/card');
const {
  AI_DELAY_MIN_MS,
  AI_DELAY_MAX_MS,
  MAX_SEATS,
} = require('../config/constants');

class AIRuleEngine {
  decide(gameState, playerId) {
    const player = gameState.players.find(p => p.playerId === playerId);
    if (!player) return { type: 'fold', delayMs: this._randomDelay() };

    const holeCards = player.holeCards;
    if (!holeCards || holeCards.length < 2) return { type: 'fold', delayMs: this._randomDelay() };

    const style = player.aiStyle || 'balanced';
    const position = player.seatPosition;
    const totalPlayers = gameState.players.length;

    const strength = this._evaluateHandStrength(holeCards, gameState.communityCards);
    const toCall = gameState.currentBet - player.bet;
    const totalPot = gameState.totalPot ?? 0;
    const potOdds = toCall / (totalPot + toCall + 0.001);

    const positionBonus = this._getPositionBonus(position, totalPlayers);
    const styleAdjustment = this._getStyleAdjustment(style);
    const effectiveScore = strength * 100 + positionBonus + styleAdjustment;

    let action;
    let amount = 0;

    if (effectiveScore < 30) {
      action = toCall === 0 ? 'check' : 'fold';
    } else if (effectiveScore < 50) {
      if (potOdds < 0.25 || toCall === 0) {
        action = toCall === 0 ? 'check' : 'call';
      } else {
        action = toCall === 0 ? 'check' : 'fold';
      }
    } else if (effectiveScore < 70) {
      if (toCall === 0) {
        action = 'raise';
        const minRaiseTotal = gameState.currentBet > 0
          ? gameState.currentBet + gameState.minRaise
          : gameState.minRaise;
        amount = Math.min(minRaiseTotal, player.chips);
      } else {
        action = 'call';
      }
    } else {
      if (toCall === 0) {
        action = 'raise';
        const minRaiseTotal = gameState.currentBet > 0
          ? gameState.currentBet + gameState.minRaise
          : gameState.minRaise;
        amount = Math.min(minRaiseTotal, player.chips);
      } else if (player.chips <= toCall || player.chips < (gameState.bigBlind || gameState.minRaise || 20) * 3) {
        action = 'allin';
      } else {
        action = 'raise';
        amount = Math.min(gameState.currentBet + gameState.minRaise, player.chips + player.bet);
      }
    }

    if (amount >= player.chips + player.bet) {
      action = 'allin';
      amount = 0;
    }

    return this._coerceToLegalDecision(
      { type: action, amount: amount > 0 ? amount : undefined },
      gameState,
      player
    );
  }

  _coerceToLegalDecision(decision, gameState, player) {
    const legal = gameState.legal_actions;
    if (!legal || !Array.isArray(legal.actions) || legal.actions.length === 0) {
      return { ...decision, delayMs: this._randomDelay() };
    }

    if (legal.actions.includes(decision.type)) {
      if (decision.type === 'raise') {
        const amount = Math.min(
          Math.max(Number(decision.amount) || legal.min_raise || 0, legal.min_raise || 0),
          legal.max_raise || Number(decision.amount) || 0
        );
        return { type: 'raise', amount, delayMs: this._randomDelay() };
      }
      return { ...decision, amount: decision.amount, delayMs: this._randomDelay() };
    }

    if (legal.actions.includes('check')) {
      return { type: 'check', delayMs: this._randomDelay() };
    }
    if (legal.actions.includes('call')) {
      return { type: 'call', delayMs: this._randomDelay() };
    }
    if (legal.actions.includes('allin')) {
      return { type: 'allin', delayMs: this._randomDelay() };
    }
    return { type: 'fold', delayMs: this._randomDelay() };
  }

  _randomDelay() {
    return AI_DELAY_MIN_MS + Math.floor(Math.random() * (AI_DELAY_MAX_MS - AI_DELAY_MIN_MS));
  }

  _evaluateHandStrength(holeCards, communityCards) {
    const parsedHole = holeCards.map(c => this._parseCard(c)).filter(Boolean);
    if (parsedHole.length !== 2) return 0;

    if (communityCards && communityCards.length >= 3) {
      const parsedCommunity = communityCards.map(c => this._parseCard(c)).filter(Boolean);
      const allCards = [...parsedHole, ...parsedCommunity];
      if (allCards.length >= 5) {
        try {
          const result = HandEvaluator.evaluate(allCards);
          return Math.max(0, 1 - (result.rank - 1) / 9);
        } catch {
          return HandEvaluator.holeCardStrength(parsedHole) / 100;
        }
      }
    }

    return HandEvaluator.holeCardStrength(parsedHole) / 100;
  }

  _parseCard(cardInput) {
    if (cardInput instanceof Card) return cardInput;
    if (typeof cardInput === 'string') {
      const match = cardInput.match(/^([2-9]|10|[JQKA])([\u2660\u2665\u2666\u2663])$/u);
      if (!match) return null;
      const suitByCode = {
        0x2660: 'spades',
        0x2665: 'hearts',
        0x2666: 'diamonds',
        0x2663: 'clubs',
      };
      return new Card(suitByCode[match[2].charCodeAt(0)], match[1]);
    }
    if (cardInput && typeof cardInput === 'object' && cardInput.suit && cardInput.rank) {
      return Card.fromJSON(cardInput);
    }
    return null;
  }

  _getPositionBonus(position, totalPlayers) {
    if (position == null || totalPlayers <= 0) return 0;
    const normalized = position / MAX_SEATS;
    return Math.round(normalized * 15);
  }

  _getStyleAdjustment(style) {
    switch (style) {
      case 'tight': return -10;
      case 'loose': return +10;
      case 'balanced':
      default: return 0;
    }
  }
}

module.exports = new AIRuleEngine();
