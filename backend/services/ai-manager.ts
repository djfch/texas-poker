/**
 * backend/services/ai-manager.ts - AI bot lifecycle and decision routing
 *
 * LLM decisions are delegated to ai-llm-service. Rule decisions live in
 * ai-rule-engine so the LLM fallback path does not create circular imports.
 */

import {
  AI_NAMES,
  AI_STYLES,
  MAX_SEATS,
} from '../config/constants';
import type { PlayerRecord } from '../storage/memory-store';
import type { AIDecision, AIGameState } from './ai-rule-engine';
import type { AIRuleEngineService } from './ai-rule-engine';
import type { AiLlmServiceType } from './ai-llm-service';
import type { PlayerManagerService } from './player-manager';
import type { RoomManagerService } from './room-manager';

const playerManager: PlayerManagerService = require('./player-manager');
const roomManager: RoomManagerService = require('./room-manager');
const aiLlmService: AiLlmServiceType = require('./ai-llm-service');
const aiRuleEngine: AIRuleEngineService = require('./ai-rule-engine');

/** Room fields read when generating a unique bot nickname. */
type RoomLike = { players?: Array<{ nickname?: unknown }> };

class AIManager {
  async decide(gameState: AIGameState, playerId: string): Promise<AIDecision> {
    if (aiLlmService.isEnabled()) {
      try {
        return await aiLlmService.decide(gameState, playerId);
      } catch (err: any) {
        console.error('[AI Manager] LLM decision failed, using rules:', err.message);
      }
    }
    return this.decideWithRules(gameState, playerId);
  }

  async createBot(roomId: string, position: number, style: string | null = null): Promise<PlayerRecord | null> {
    const room = await roomManager.getRoom(roomId);
    if (!room) return null;
    if (position < 0 || position >= MAX_SEATS) return null;
    if (room.seats[position]) return null;

    const botStyle = style || AI_STYLES[Math.floor(Math.random() * AI_STYLES.length)];
    const nickname = this._generateUniqueBotNickname(room);
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

  async removeBot(roomId: string, position: number): Promise<boolean> {
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

  async fillRoomWithAI(roomId: string): Promise<PlayerRecord[]> {
    const room = await roomManager.getRoom(roomId);
    if (!room || !room.allowAI) return [];

    const bots: PlayerRecord[] = [];
    const seatedCount = room.players.filter(p => p.seatPosition >= 0).length;
    const needed = room.maxPlayers - seatedCount;

    for (let i = 0; i < needed; i++) {
      // Re-read every round: copy-returning stores (Redis) hand back a
      // fresh snapshot, so the seat taken by the previous createBot() is
      // only visible on a new read — looping on the stale copy would pick
      // the same seat each time and add a single bot.
      const fresh = await roomManager.getRoom(roomId);
      if (!fresh) break;
      const position = fresh.seats.findIndex((pid, idx) => !pid && idx < MAX_SEATS);
      if (position === -1) break;
      const bot = await this.createBot(roomId, position);
      if (bot) bots.push(bot);
    }

    return bots;
  }

  decideWithRules(gameState: AIGameState, playerId: string): AIDecision {
    return aiRuleEngine.decide(gameState, playerId);
  }

  _generateUniqueBotNickname(room: RoomLike): string {
    const existingNicknames = new Set(
      (room.players || [])
        .map(player => String(player.nickname || '').trim())
        .filter(Boolean)
    );
    const availableNames = AI_NAMES.filter(name => !existingNicknames.has(`Bot-${name}`));

    if (availableNames.length > 0) {
      const name = availableNames[Math.floor(Math.random() * availableNames.length)];
      return `Bot-${name}`;
    }

    for (let suffix = 2; suffix < 100; suffix++) {
      for (const name of AI_NAMES) {
        const nickname = `Bot-${name}-${suffix}`;
        if (!existingNicknames.has(nickname)) return nickname;
      }
    }

    return `Bot-${Date.now()}`;
  }
}

/** Instance type for typed cross-service imports (erased at runtime). */
export type AIManagerService = AIManager;

// Export the singleton instance exactly like the former .js module did;
// plain `module.exports =` stays runtime-safe under tsx/esbuild (see
// backend/storage/memory-store.ts for the detailed rationale).
module.exports = new AIManager();
