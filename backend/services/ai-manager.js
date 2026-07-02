/**
 * backend/services/ai-manager.js - AI bot lifecycle and decision routing
 *
 * LLM decisions are delegated to ai-llm-service. Rule decisions live in
 * ai-rule-engine so the LLM fallback path does not create circular imports.
 */

const {
  AI_NAMES,
  AI_STYLES,
  MAX_SEATS,
} = require('../config/constants');

const playerManager = require('./player-manager');
const roomManager = require('./room-manager');
const aiLlmService = require('./ai-llm-service');
const aiRuleEngine = require('./ai-rule-engine');

class AIManager {
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

  decideWithRules(gameState, playerId) {
    return aiRuleEngine.decide(gameState, playerId);
  }
}

module.exports = new AIManager();
