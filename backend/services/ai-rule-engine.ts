/**
 * backend/services/ai-rule-engine.ts - rule-based AI decision fallback
 *
 * Kept independent from ai-manager and ai-llm-service to avoid circular imports.
 */

import { HandEvaluator } from '../domain/hand-evaluator';
import { Card } from '../domain/card';
import {
  AI_DELAY_MIN_MS,
  AI_DELAY_MAX_MS,
  MAX_SEATS,
} from '../config/constants';

/** Legal-action block attached to the AI decision context by game-engine. */
export interface LegalActions {
  actions?: string[];
  to_call?: number;
  min_raise?: number;
  max_raise?: number;
}

/** Player fields the AI services read from a sanitized game state. */
export interface AIPlayerState {
  playerId: string;
  nickname?: string;
  seatPosition: number;
  chips: number;
  bet: number;
  folded?: boolean;
  aiStyle?: string;
  holeCards?: any[]; // Card | string | CardJSON depending on the caller
}

/**
 * Minimal shape of the sanitized game state the AI services consume.
 * Extra fields (action_history, position_context, ...) flow through the
 * index signature; game-engine owns the full payload.
 */
export interface AIGameState {
  status: string;
  players: AIPlayerState[];
  communityCards?: any[];
  currentBet: number;
  minRaise: number;
  totalPot?: number;
  bigBlind?: number;
  legal_actions?: LegalActions;
  [key: string]: any;
}

/** Decision DTO returned by every AI service (rule and LLM paths). */
export interface AIDecision {
  type: string;
  amount?: number;
  delayMs: number;
  reason?: string;
}

/** Raw decision before _coerceToLegalDecision attaches a delay. */
interface PendingDecision {
  type: string;
  amount?: number;
}

class AIRuleEngine {
  decide(gameState: AIGameState, playerId: string): AIDecision {
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

    let action: string;
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

  _coerceToLegalDecision(decision: PendingDecision, gameState: AIGameState, player: AIPlayerState): AIDecision {
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

  _randomDelay(): number {
    return AI_DELAY_MIN_MS + Math.floor(Math.random() * (AI_DELAY_MAX_MS - AI_DELAY_MIN_MS));
  }

  _evaluateHandStrength(holeCards: any[], communityCards?: any[]): number {
    const parsedHole = holeCards.map(c => this._parseCard(c)).filter((c): c is Card => Boolean(c));
    if (parsedHole.length !== 2) return 0;

    if (communityCards && communityCards.length >= 3) {
      const parsedCommunity = communityCards.map(c => this._parseCard(c)).filter((c): c is Card => Boolean(c));
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

  _parseCard(cardInput: any): Card | null {
    if (cardInput instanceof Card) return cardInput;
    if (typeof cardInput === 'string') {
      const match = cardInput.match(/^([2-9]|10|[JQKA])([♠♥♦♣])$/u);
      if (!match) return null;
      const suitByCode: Record<number, string> = {
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

  _getPositionBonus(position: number | null | undefined, totalPlayers: number): number {
    if (position == null || totalPlayers <= 0) return 0;
    const normalized = position / MAX_SEATS;
    return Math.round(normalized * 15);
  }

  _getStyleAdjustment(style: string): number {
    switch (style) {
      case 'tight': return -10;
      case 'loose': return +10;
      case 'balanced':
      default: return 0;
    }
  }
}

/** Instance type for typed cross-service imports (erased at runtime). */
export type AIRuleEngineService = AIRuleEngine;

// Export the singleton instance exactly like the former .js module did;
// plain `module.exports =` stays runtime-safe under tsx/esbuild (see
// backend/storage/memory-store.ts for the detailed rationale).
module.exports = new AIRuleEngine();
