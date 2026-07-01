/**
 * backend/services/ai-manager.js - AI Bot Decision Making
 *
 * Rule-based AI for Texas Hold'em with configurable styles.
 * When an LLM is configured via .env, it delegates decisions to ai-llm-service.
 */

const { HandEvaluator } = require('../domain/hand-evaluator');
const { Card } = require('../domain/card');
const {
  AI_NAMES,
  AI_STYLES,
  AI_DELAY_MIN_MS,
  AI_DELAY_MAX_MS,
  MAX_SEATS,
} = require('../config/constants');

const playerManager = require('./player-manager');
const roomManager = require('./room-manager');
const aiLlmService = require('./ai-llm-service');

class AIManager {
  /**
   * Decide an action for an AI player.
   * If LLM is enabled and configured, use it; otherwise fall back to rules.
   */
  async decide(gameState, playerId) {
    if (aiLlmService.isEnabled()) {
      try {
        return await aiLlmService.decide(gameState, playerId);
      } catch (err) {
        console.error('[AI Manager] LLM decision failed, using rules:', err.message);
      }
    }
    return this.decideWithRules(gameState, playerId);
  }

  /**
   * Create an AI bot, add it to the room, and seat it at the given position.
   */
  async createBot(roomId, position, style = null) {
    const room = await roomManager.getRoom(roomId);
    if (!room) return null;
    if (position < 0 || position >= MAX_SEATS) return null;
    if (room.seats[position]) return null;

    const name = AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)];
    const botStyle = style || AI_STYLES[Math.floor(Math.random() * AI_STYLES.length)];
    const nickname = `Bot-${name}`;
    const avatar = '/assets/bot-avatar.png';

    const botPlayer = await playerManager.createGuest(null);
    botPlayer.nickname = nickname;
    botPlayer.avatar = avatar;
    botPlayer.isAI = true;
    botPlayer.aiStyle = botStyle;
    await playerManager.updatePlayer(botPlayer.id, botPlayer);

    await roomManager.joinRoom(roomId, botPlayer.id);
    await roomManager.sit(roomId, botPlayer.id, position);
    await roomManager.ready(roomId, botPlayer.id, true);

    return botPlayer;
  }

  /**
   * Remove an AI bot from a seat.
   */
  async removeBot(roomId, position) {
    const room = await roomManager.getRoom(roomId);
    if (!room) return false;
    const playerId = room.seats[position];
    if (!playerId) return false;

    const player = await playerManager.getPlayerById(playerId);
    if (!player || !player.isAI) return false;

    await roomManager.leaveRoom(roomId, playerId);
    await playerManager.removePlayer(playerId);
    return true;
  }

  /**
   * Fill all empty seats with AI bots up to maxPlayers.
   */
  async fillRoomWithAI(roomId) {
    const room = await roomManager.getRoom(roomId);
    if (!room || !room.allowAI) return [];

    const bots = [];
    const seatedCount = room.players.filter(p => p.seatPosition >= 0).length;
    const needed = room.maxPlayers - seatedCount;

    for (let i = 0; i < needed; i++) {
      const position = room.seats.findIndex((pid, idx) => !pid && idx < MAX_SEATS);
      if (position === -1) break;
      const bot = await this.createBot(roomId, position);
      if (bot) bots.push(bot);
    }

    return bots;
  }

  /**
   * Rule-based decision (kept as fallback and for offline use).
   * Returns { type, amount?, delayMs }.
   */
  decideWithRules(gameState, playerId) {
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
      } else if (player.chips <= toCall || player.chips < gameState.bigBlind * 3) {
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

    return { type: action, amount: amount > 0 ? amount : undefined, delayMs: this._randomDelay() };
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
      const match = cardInput.match(/^([2-9]|10|[JQKA])([♠♥♦♣])$/);
      if (!match) return null;
      const rank = match[1];
      const suitSymbol = match[2];
      const suitMap = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
      return new Card(suitMap[suitSymbol], rank);
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

module.exports = new AIManager();
