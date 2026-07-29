/**
 * backend/services/game-engine.ts - Texas Hold'em Game Engine
 *
 * Core game logic: dealing, betting rounds, showdown, pot distribution.
 * Server-authoritative - all state transitions happen here.
 * All mutating entry points are serialized per room through action-queue.
 */

import { Deck } from '../domain/deck';
import { HandEvaluator } from '../domain/hand-evaluator';
import type { HandResult } from '../domain/hand-evaluator';
import { PotManager } from '../domain/pot-manager';
import type { PotBreakdown, SeatInput } from '../domain/pot-manager';
import type { Card, CardJSON } from '../domain/card';
import type { PlayerRecord, RoomRecord, Storage } from '../storage/memory-store';
import {
  MIN_PLAYERS,
  MAX_SEATS,
  HAND_NAMES_CN,
} from '../config/constants';
import type { EnqueueFn } from './action-queue';

// findLastIndex is an ES2023 builtin: Node 18+ runs it, but the ES2022 lib
// types used by tsconfig do not declare it. Augment Array globally instead of
// widening the project's compiler target.
declare global {
  interface Array<T> {
    findLastIndex(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): number;
  }
}

const store: Storage = require('../storage/memory-store');
const actionQueue: { enqueue: EnqueueFn } = require('./action-queue');

/** Common result envelope returned by engine operations. */
interface ServiceResult {
  success: boolean;
  error?: string;
  [key: string]: any;
}

/** Betting streets that have their own action history bucket. */
type Street = 'preflop' | 'flop' | 'turn' | 'river';

/** One action log entry inside a street's action history. */
interface ActionHistoryEntry {
  seat_position: number;
  player_name: string;
  action: string;
  amount: number;
  pot_after: number;
}

/** Per-street action history tracked on the game object. */
type ActionHistory = Record<Street, ActionHistoryEntry[]>;

/** A player seated in a running game. */
interface GamePlayer {
  playerId: string;
  nickname: string;
  avatar: string;
  seatPosition: number;
  holeCards: Card[];
  chips: number;
  startingChips: number;
  bet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  [key: string]: any;
}

/** One winner entry produced at showdown. */
interface GameWinner {
  playerId: string;
  position: number;
  nickname: string;
  amount: number;
  payout: number;
  hand: string;
}

/** Per-player chip delta entry attached to an ended game. */
interface GameHandResult {
  playerId: string;
  position: number;
  nickname: string;
  chips: number;
  startingChips: number;
  delta: number;
  isWinner: boolean;
}

/** Per-player showdown reveal entry attached to an ended game. */
interface GameShowdownResult {
  playerId: string;
  position: number;
  nickname: string;
  cards: string[];
  handName: string | null;
  isWinner: boolean;
}

/** Full mutable game object stored in the memory store. */
interface PokerGame {
  roomId: string;
  status: string; // preflop, flop, turn, river, showdown, ended
  deck: Deck;
  communityCards: Card[];
  pots: PotManager;
  players: GamePlayer[];
  dealerPosition: number | null;
  smallBlindPos: number | null;
  bigBlindPos: number | null;
  currentPosition: number | null;
  currentBet: number;
  minRaise: number;
  actionsTaken: Set<string>;
  actionHistory: ActionHistory;
  winners?: GameWinner[] | null;
  handResults?: GameHandResult[] | null;
  showdownResults?: GameShowdownResult[] | null;
  [key: string]: any; // runtime annotations set by the socket layer (turn timers live in the scheduler layer, never on this entity — see INV2 in socket/handlers.ts)
}

/** Room player fields the engine reads when starting a hand. */
interface RoomSeatPlayer {
  playerId: string;
  nickname: string;
  avatar: string;
  seatPosition: number;
  chips: number;
  [key: string]: any;
}

/** One action offered to a player by getValidActions(). */
interface ValidAction {
  type: string;
  amount?: number;
  minAmount?: number;
  maxAmount?: number;
}

/** legal_actions block of the AI decision context. */
interface LegalActions {
  actions: string[];
  to_call: number;
  min_raise: number;
  max_raise: number;
}

/** position_context block of the AI decision context. */
interface PositionContext {
  dealer_position: number | null;
  small_blind_position: number | null;
  big_blind_position: number | null;
  acting_order: number[];
  players_after_me: number;
}

/** pot_odds block of the AI decision context. */
interface PotOdds {
  pot_size: number;
  to_call: number;
  pot_odds: number;
  effective_stack: number;
  spr: number;
}

/** Player view inside a sanitized game state. */
interface SanitizedGamePlayer {
  playerId: string;
  nickname: string;
  avatar: string;
  seatPosition: number;
  chips: number;
  startingChips: number;
  bet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  holeCards: string[] | null;
}

/** Sanitized game state DTO returned to clients and AI consumers. */
interface SanitizedGameState {
  status: string;
  communityCards: string[];
  pots: PotBreakdown;
  totalPot: number;
  currentBet: number;
  minRaise: number;
  dealerPosition: number | null;
  smallBlindPos: number | null;
  bigBlindPos: number | null;
  currentPosition: number | null;
  currentPlayerId: string | null;
  players: SanitizedGamePlayer[];
  winners: GameWinner[] | null;
  handResults: GameHandResult[] | null;
  showdownResults: GameShowdownResult[] | null;
}

/** AI decision context: sanitized state plus server-computed helpers. */
interface AIDecisionContext extends SanitizedGameState {
  legal_actions: LegalActions;
  action_history: ActionHistory;
  position_context: PositionContext;
  pot_odds: PotOdds;
}

/** One private deal payload (hole cards) for a seated player. */
interface PrivateDeal {
  playerId: string;
  position: number;
  cards: CardJSON[];
}

/** Anything carrying the AI markers checked by _isAIPlayer(). */
type MaybeAI = { isAI?: boolean; nickname?: unknown } | null | undefined;

class GameEngine {
  async startGame(roomId: string): Promise<ServiceResult> {
    return actionQueue.enqueue(roomId, () => this._startGame(roomId));
  }

  async _startGame(roomId: string): Promise<ServiceResult> {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    // Never replace a live hand; only an ended one may be superseded.
    const existing = await store.getGame(roomId);
    if (existing && existing.status !== 'ended' && existing.status !== 'showdown') {
      return { success: false, error: 'Game already in progress' };
    }

    const seated: RoomSeatPlayer[] = room.players.filter((p: RoomSeatPlayer) => p.seatPosition >= 0);
    if (seated.length < MIN_PLAYERS) {
      return { success: false, error: `Need at least ${MIN_PLAYERS} players` };
    }

    // Sort by seat position for deterministic processing
    seated.sort((a, b) => a.seatPosition - b.seatPosition);

    const brokePlayer = seated.find(p => (p.chips ?? 0) <= 0);
    if (brokePlayer) {
      return { success: false, error: `${brokePlayer.nickname || 'Player'} has no chips` };
    }

    // Create PotManager with initial seats
    const potSeats: SeatInput[] = seated.map(p => ({
      position: p.seatPosition,
      totalBet: 0,
      status: 'active',
      chips: p.chips,
    }));

    const game: PokerGame = {
      roomId,
      status: 'preflop',
      deck: new Deck(),
      communityCards: [],
      pots: new PotManager(potSeats),
      players: seated.map(p => ({
        playerId: p.playerId,
        nickname: p.nickname,
        avatar: p.avatar,
        seatPosition: p.seatPosition,
        holeCards: [],
        chips: p.chips,
        startingChips: p.chips,
        bet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
      })),
      dealerPosition: this._getNextDealerPosition(room, seated),
      smallBlindPos: null,
      bigBlindPos: null,
      currentPosition: null,
      currentBet: 0,
      minRaise: room.bigBlind,
      actionsTaken: new Set(),
      actionHistory: this._createActionHistory(),
    };

    // Shuffle before dealing
    game.deck.shuffle();

    // Deal hole cards (1 at a time like real poker)
    for (let i = 0; i < 2; i++) {
      for (const player of game.players) {
        player.holeCards.push(...game.deck.deal(1));
      }
    }

    // Post blinds based on real occupied seats
    const occupiedPositions = seated.map(p => p.seatPosition).sort((a, b) => a - b);
    const blindPositions = this._getBlindPositions(game.dealerPosition, occupiedPositions);
    game.smallBlindPos = blindPositions.smallBlind;
    game.bigBlindPos = blindPositions.bigBlind;

    const sb = game.players.find(p => p.seatPosition === game.smallBlindPos);
    const bb = game.players.find(p => p.seatPosition === game.bigBlindPos);

    if (sb) {
      const amount = this._placeBet(game, sb, room.smallBlind);
      this._recordAction(game, sb, 'small_blind', amount);
    }
    if (bb) {
      const amount = this._placeBet(game, bb, room.bigBlind);
      this._recordAction(game, bb, 'big_blind', amount);
    }

    game.currentBet = room.bigBlind;
    game.minRaise = room.bigBlind;

    // First to act: after big blind (clockwise next occupied seat)
    game.currentPosition = this._findNextActiveSeat(game.bigBlindPos, occupiedPositions);

    await store.createGame(game);
    room.status = 'playing';
    await store.updateRoom(roomId, { status: 'playing', currentGameId: roomId });

    return {
      success: true,
      game: this._sanitizeGameState(game, true, null),
    };
  }

  async handleAction(roomId: string, playerId: string, action: string, amount = 0): Promise<ServiceResult> {
    return actionQueue.enqueue(roomId, () => this._handleAction(roomId, playerId, action, amount));
  }

  async _handleAction(roomId: string, playerId: string, action: string, amount = 0): Promise<ServiceResult> {
    const game = (await store.getGame(roomId)) as PokerGame | null;
    if (!game) return { success: false, error: 'No active game' };

    const player = game.players.find(p => p.playerId === playerId);
    if (!player) return { success: false, error: 'Not in game' };
    if (player.folded || player.allIn) return { success: false, error: 'Cannot act' };

    const currentPlayer = game.players.find(p => p.seatPosition === game.currentPosition);
    if (!currentPlayer || currentPlayer.playerId !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    const toCall = game.currentBet - player.bet;
    const numericAmount = Number(amount);
    let historyAction = action;
    let historyAmount = 0;

    switch (action) {
      case 'fold':
        player.folded = true;
        game.pots.setStatus(player.seatPosition, 'folded');
        break;

      case 'check':
        if (toCall > 0) {
          return { success: false, error: 'Cannot check, must call or raise' };
        }
        break;

      case 'call':
        historyAmount = this._placeBet(game, player, Math.min(toCall, player.chips));
        break;

      case 'raise':
      case 'bet': {
        const totalBet = numericAmount;
        if (!Number.isFinite(totalBet) || totalBet < 0) {
          return { success: false, error: 'Invalid raise amount' };
        }
        const raiseSize = totalBet - player.bet;
        const minTotalBet = game.currentBet + game.minRaise;
        const isAllIn = totalBet >= player.chips + player.bet;

        if (totalBet < game.currentBet) {
          return { success: false, error: 'Raise must be at least the current bet' };
        }
        if (raiseSize < game.minRaise && !isAllIn) {
          return { success: false, error: `Raise must be at least ${minTotalBet} total` };
        }
        if (totalBet > player.chips + player.bet) {
          return { success: false, error: 'Not enough chips' };
        }
        const oldCurrentBet = game.currentBet;
        this._placeBet(game, player, totalBet - player.bet);
        game.currentBet = player.bet;
        game.minRaise = player.bet - oldCurrentBet;
        game.actionsTaken.clear();
        historyAction = 'raise';
        historyAmount = player.bet;
        break;
      }

      case 'allin':
        historyAmount = this._placeBet(game, player, player.chips);
        if (player.bet > game.currentBet) {
          const oldCurrentBet = game.currentBet;
          const raiseSize = player.bet - oldCurrentBet;
          game.currentBet = player.bet;
          if (raiseSize >= game.minRaise) {
            game.minRaise = raiseSize;
            game.actionsTaken.clear();
          }
        }
        break;

      default:
        return { success: false, error: 'Invalid action' };
    }

    this._recordAction(game, player, historyAction, historyAmount);
    game.actionsTaken.add(playerId);

    if (await this._isRoundComplete(game)) {
      await this._advancePhase(game);
    } else {
      await this._nextPlayer(game);
    }

    // Persist the mutations. The memory store returns the live object from
    // getGame(), so this updateGame() is a self-assign no-op there; stores
    // that hand out detached copies (Redis JSON round-trip) would otherwise
    // silently drop every action applied above.
    await store.updateGame(game.roomId, game);

    return {
      success: true,
      game: this._sanitizeGameState(game, true, null),
    };
  }

  async getGameState(roomId: string, playerId: string | null): Promise<SanitizedGameState | null> {
    const game = (await store.getGame(roomId)) as PokerGame | null;
    if (!game) return null;
    return this._sanitizeGameState(game, true, playerId);
  }

  async getPrivateDeals(roomId: string): Promise<PrivateDeal[]> {
    const game = (await store.getGame(roomId)) as PokerGame | null;
    if (!game) return [];

    return game.players.map(p => ({
      playerId: p.playerId,
      position: p.seatPosition,
      cards: p.holeCards.map(c => c.toJSON()),
    }));
  }

  async getAIDecisionContext(roomId: string, playerId: string): Promise<AIDecisionContext | null> {
    const game = (await store.getGame(roomId)) as PokerGame | null;
    if (!game) return null;

    const state = this._sanitizeGameState(game, true, playerId);
    return {
      ...state,
      legal_actions: this._buildLegalActions(game, playerId),
      action_history: this._sanitizeActionHistory(game),
      position_context: this._buildPositionContext(game, playerId),
      pot_odds: this._buildPotOdds(game, playerId),
    };
  }

  async isPlayerTurn(roomId: string, playerId: string): Promise<boolean | undefined> {
    const game = (await store.getGame(roomId)) as PokerGame | null;
    if (!game) return false;
    const player = game.players.find(p => p.seatPosition === game.currentPosition);
    // Original returns a falsy undefined when nobody sits on the current seat.
    return (player && player.playerId === playerId) as boolean;
  }

  async getValidActions(roomId: string, playerId: string): Promise<ValidAction[]> {
    const game = (await store.getGame(roomId)) as PokerGame | null;
    if (!game) return [];
    return this._getValidActionsForGame(game, playerId);
  }

  async timeoutFold(roomId: string, seatPosition: number): Promise<ServiceResult> {
    return actionQueue.enqueue(roomId, () => this._timeoutFold(roomId, seatPosition));
  }

  async _timeoutFold(roomId: string, seatPosition: number): Promise<ServiceResult> {
    const game = (await store.getGame(roomId)) as PokerGame | null;
    if (!game) return { success: false, error: 'No active game' };
    const player = game.players.find(p => p.seatPosition === seatPosition);
    if (!player) return { success: false, error: 'Player not found' };
    return this._handleAction(roomId, player.playerId, 'fold');
  }

  async playerDisconnect(roomId: string, playerId: string): Promise<ServiceResult> {
    return actionQueue.enqueue(roomId, () => this._playerDisconnect(roomId, playerId));
  }

  async _playerDisconnect(roomId: string, playerId: string): Promise<ServiceResult> {
    const game = (await store.getGame(roomId)) as PokerGame | null;
    if (!game) return { success: false, error: 'No active game' };
    const player = game.players.find(p => p.playerId === playerId);
    if (!player || player.folded || player.allIn) {
      return { success: false, error: 'Cannot act for player' };
    }
    return this._handleAction(roomId, playerId, 'fold');
  }

  async nextHand(roomId: string): Promise<ServiceResult> {
    return actionQueue.enqueue(roomId, () => this._nextHand(roomId));
  }

  async _nextHand(roomId: string): Promise<ServiceResult> {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    // Persist dealer position for next hand rotation
    const game = await store.getGame(roomId);
    if (game) {
      await store.updateRoom(roomId, {
        status: 'waiting',
        currentGameId: null,
        dealerPosition: game.dealerPosition,
      });
      await store.deleteGame(roomId);
      return { success: true, room: await store.getRoom(roomId) };
    }

    await store.updateRoom(roomId, { status: 'waiting', currentGameId: null });
    return { success: true, room: await store.getRoom(roomId) };
  }

  // ─── Internal ──────────────────────────────────────────────────

  _getNextDealerPosition(room: RoomRecord, seated: RoomSeatPlayer[]): number | null {
    if (!room.dealerPosition && room.dealerPosition !== 0) {
      return seated[0].seatPosition;
    }
    const occupied = seated.map(p => p.seatPosition).sort((a, b) => a - b);
    return this._findNextActiveSeat(room.dealerPosition, occupied);
  }

  _getBlindPositions(dealerPosition: number | null, occupiedPositions: number[]): { smallBlind: number | null; bigBlind: number | null } {
    if (occupiedPositions.length === 2) {
      // Heads-up: dealer is small blind, opponent is big blind
      return {
        smallBlind: dealerPosition,
        bigBlind: this._findNextActiveSeat(dealerPosition, occupiedPositions),
      };
    }
    return {
      smallBlind: this._findNextActiveSeat(dealerPosition, occupiedPositions),
      bigBlind: this._findNextActiveSeat(
        this._findNextActiveSeat(dealerPosition, occupiedPositions),
        occupiedPositions
      ),
    };
  }

  _findNextActiveSeat(fromPosition: number | null, occupiedPositions: number[] | null): number | null {
    if (!occupiedPositions || occupiedPositions.length === 0) return null;
    const sorted = [...occupiedPositions].sort((a, b) => a - b);
    // Callers never pass a null fromPosition together with a non-empty list;
    // the original JS compared against the value directly.
    const idx = sorted.findIndex(pos => pos > (fromPosition as number));
    return idx === -1 ? sorted[0] : sorted[idx];
  }

  _findPreviousActiveSeat(fromPosition: number | null, occupiedPositions: number[] | null): number | null {
    if (!occupiedPositions || occupiedPositions.length === 0) return null;
    const sorted = [...occupiedPositions].sort((a, b) => a - b);
    // Same null-narrowing rationale as _findNextActiveSeat.
    const idx = sorted.findLastIndex(pos => pos < (fromPosition as number));
    return idx === -1 ? sorted[sorted.length - 1] : sorted[idx];
  }

  _placeBet(game: PokerGame, player: GamePlayer, amount: number): number {
    const actualBet = Math.min(amount, player.chips);
    player.chips -= actualBet;
    player.bet += actualBet;
    player.totalBet += actualBet;

    if (player.chips === 0) {
      player.allIn = true;
      game.pots.setStatus(player.seatPosition, 'allin');
    }

    game.pots.addBet(player.seatPosition, actualBet);
    return actualBet;
  }

  _getValidActionsForGame(game: PokerGame, playerId: string): ValidAction[] {
    const player = game.players.find(p => p.playerId === playerId);
    if (!player || player.folded || player.allIn) return [];
    const currentPlayer = game.players.find(p => p.seatPosition === game.currentPosition);
    if (!currentPlayer || currentPlayer.playerId !== playerId) return [];

    const toCall = game.currentBet - player.bet;
    const actions: ValidAction[] = [];
    const addAction = (action: ValidAction) => {
      if (!actions.some(item => item.type === action.type)) {
        actions.push(action);
      }
    };

    if (toCall === 0) {
      addAction({ type: 'check' });
      addAction({
        type: 'bet',
        minAmount: game.minRaise,
        maxAmount: player.chips,
      });
    } else {
      addAction({ type: 'fold' });
      if (player.chips <= toCall) {
        addAction({ type: 'allin' });
      } else {
        addAction({
          type: 'call',
          amount: toCall,
        });
        addAction({
          type: 'raise',
          minAmount: game.currentBet + game.minRaise,
          maxAmount: player.chips + player.bet,
        });
      }
    }

    if (player.chips > 0) {
      addAction({ type: 'allin' });
    }

    return actions;
  }

  _buildLegalActions(game: PokerGame, playerId: string): LegalActions {
    const player = game.players.find(p => p.playerId === playerId);
    const validActions = this._getValidActionsForGame(game, playerId);
    const actions: string[] = [];
    for (const item of validActions) {
      const type = item.type === 'bet' ? 'raise' : item.type;
      if (!actions.includes(type)) actions.push(type);
    }

    const raiseAction = validActions.find(a => a.type === 'raise' || a.type === 'bet');
    const toCall = player ? Math.max(0, game.currentBet - player.bet) : 0;

    return {
      actions,
      to_call: toCall,
      min_raise: raiseAction?.minAmount ?? 0,
      max_raise: raiseAction?.maxAmount ?? 0,
    };
  }

  _buildPositionContext(game: PokerGame, playerId: string): PositionContext {
    const player = game.players.find(p => p.playerId === playerId);
    const activePositions = game.players
      .filter(p => !p.folded && !p.allIn)
      .map(p => p.seatPosition)
      .sort((a, b) => a - b);

    let actingOrder = activePositions;
    if (game.currentPosition != null && activePositions.length > 0) {
      const startIndex = activePositions.indexOf(game.currentPosition);
      if (startIndex >= 0) {
        actingOrder = activePositions.slice(startIndex).concat(activePositions.slice(0, startIndex));
      }
    }

    const playerIndex = player ? actingOrder.indexOf(player.seatPosition) : -1;

    return {
      dealer_position: game.dealerPosition,
      small_blind_position: game.smallBlindPos,
      big_blind_position: game.bigBlindPos,
      acting_order: actingOrder,
      players_after_me: playerIndex >= 0 ? actingOrder.length - playerIndex - 1 : 0,
    };
  }

  _buildPotOdds(game: PokerGame, playerId: string): PotOdds {
    const player = game.players.find(p => p.playerId === playerId);
    if (!player) {
      return {
        pot_size: game.pots.getTotalPot(),
        to_call: 0,
        pot_odds: 0,
        effective_stack: 0,
        spr: 0,
      };
    }

    const potSize = game.pots.getTotalPot();
    const toCall = Math.max(0, game.currentBet - player.bet);
    const opponents = game.players.filter(p => p.playerId !== playerId && !p.folded);
    const largestOpponentStack = opponents.length ? Math.max(...opponents.map(p => p.chips)) : 0;
    const effectiveStack = opponents.length ? Math.min(player.chips, largestOpponentStack) : 0;

    return {
      pot_size: potSize,
      to_call: toCall,
      pot_odds: this._roundRatio(toCall > 0 ? toCall / (potSize + toCall) : 0),
      effective_stack: effectiveStack,
      spr: this._roundRatio(potSize > 0 ? effectiveStack / potSize : 0),
    };
  }

  _createActionHistory(): ActionHistory {
    return {
      preflop: [],
      flop: [],
      turn: [],
      river: [],
    };
  }

  _recordAction(game: PokerGame, player: GamePlayer, action: string, amount: number): void {
    if (!game.actionHistory) game.actionHistory = this._createActionHistory();
    const street = this._streetKey(game.status);
    if (!street) return;

    game.actionHistory[street].push({
      seat_position: player.seatPosition,
      player_name: player.nickname,
      action,
      amount: Number(amount) || 0,
      pot_after: game.pots.getTotalPot(),
    });
  }

  _sanitizeActionHistory(game: PokerGame): ActionHistory {
    const source = game.actionHistory || this._createActionHistory();
    const history = this._createActionHistory();
    for (const street of Object.keys(history) as Street[]) {
      history[street] = (source[street] || []).map(item => ({ ...item }));
    }
    return history;
  }

  _streetKey(status: string): Street | null {
    return ['preflop', 'flop', 'turn', 'river'].includes(status) ? status as Street : null;
  }

  _roundRatio(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(4));
  }

  async _nextPlayer(game: PokerGame): Promise<void> {
    const occupiedPositions = game.players.map(p => p.seatPosition).sort((a, b) => a - b);
    const canAct = (player: GamePlayer | null | undefined): player is GamePlayer =>
      Boolean(player && !player.folded && !player.allIn);
    const active = game.players.filter(canAct);
    if (active.length === 0) {
      await this._advancePhase(game);
      return;
    }

    const startPos = game.currentPosition;
    let nextPos = game.currentPosition;
    for (let i = 0; i < occupiedPositions.length; i++) {
      nextPos = this._findNextActiveSeat(nextPos, occupiedPositions);
      const nextPlayer = game.players.find(p => p.seatPosition === nextPos);
      if (canAct(nextPlayer)) {
        game.currentPosition = nextPos;
        return;
      }
      if (nextPos === startPos) break;
    }

    await this._advancePhase(game);
  }

  async _isRoundComplete(game: PokerGame): Promise<boolean> {
    const active = game.players.filter(p => !p.folded);
    if (active.length <= 1) return true;

    const nonAllIn = active.filter(p => !p.allIn);
    if (nonAllIn.length === 0) return true;

    const allActed = nonAllIn.every(p => game.actionsTaken.has(p.playerId));
    if (!allActed) return false;

    return nonAllIn.every(p => p.bet === game.currentBet);
  }

  async _advancePhase(game: PokerGame): Promise<void> {
    const room = await store.getRoom(game.roomId);
    const bigBlind = room ? room.bigBlind : 20;

    // Clear current round bets (PotManager already tracks total bets via _placeBet)
    for (const player of game.players) {
      player.bet = 0;
    }
    game.currentBet = 0;
    game.minRaise = bigBlind;
    game.actionsTaken.clear();

    const active = game.players.filter(p => !p.folded);
    if (active.length <= 1) {
      await this._showdown(game);
      return;
    }

    // If no more betting is possible, deal the rest of the board and go to showdown.
    if (active.filter(p => !p.allIn).length <= 1) {
      while (game.communityCards.length < 5) {
        game.communityCards.push(...game.deck.deal(5 - game.communityCards.length));
      }
      await this._showdown(game);
      return;
    }

    switch (game.status) {
      case 'preflop':
        game.status = 'flop';
        game.communityCards.push(...game.deck.deal(3));
        break;
      case 'flop':
        game.status = 'turn';
        game.communityCards.push(...game.deck.deal(1));
        break;
      case 'turn':
        game.status = 'river';
        game.communityCards.push(...game.deck.deal(1));
        break;
      case 'river':
        await this._showdown(game);
        return;
    }

    // First to act after flop/turn/river is small blind (or first active after it)
    const occupiedPositions = game.players.map(p => p.seatPosition).sort((a, b) => a - b);
    game.currentPosition = this._findPreviousActiveSeat(game.smallBlindPos, occupiedPositions);
    await this._nextPlayer(game);
  }

  async _showdown(game: PokerGame): Promise<void> {
    game.status = 'showdown';
    const activePlayers = game.players.filter(p => !p.folded);

    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const totalPot = game.pots.getTotalPot();
      winner.chips += totalPot;
      game.winners = [{
        playerId: winner.playerId,
        position: winner.seatPosition,
        nickname: winner.nickname,
        amount: totalPot,
        payout: totalPot,
        hand: 'All others folded',
      }];
    } else {
      // Use PotManager's distribute method
      const handResults = activePlayers.map(player => {
        const hand = [...player.holeCards, ...game.communityCards];
        const handResult = HandEvaluator.evaluate(hand);
        return {
          position: player.seatPosition,
          handResult,
          handName: HAND_NAMES_CN[handResult.rank as keyof typeof HAND_NAMES_CN] || handResult.name,
        };
      });

      // Entries carry full HandResult objects; PotManager only reads rank/kickers.
      const payouts = game.pots.distribute(handResults, (a, b) => {
        return HandEvaluator.compare(a.handResult as HandResult, b.handResult as HandResult);
      });

      game.winners = [];
      for (const [position, amount] of Object.entries(payouts)) {
        if (amount > 0) {
          const player = game.players.find(p => p.seatPosition === parseInt(position));
          if (player) {
            player.chips += amount;
            const hr = handResults.find(h => h.position === parseInt(position));
            game.winners.push({
              playerId: player.playerId,
              position: player.seatPosition,
              nickname: player.nickname,
              amount,
              payout: amount,
              hand: hr ? hr.handResult.name : 'Unknown',
            });
          }
        }
      }
    }

    game.status = 'ended';
    game.handResults = this._buildHandResults(game);
    game.showdownResults = this._buildShowdownResults(game);

    const room = await store.getRoom(game.roomId);
    if (room) {
      for (const gp of game.players) {
        const rp = room.players.find((p: any) => p.playerId === gp.playerId);
        if (rp) {
          rp.chips = gp.chips;
          rp.isReady = this._isAIPlayer(rp) && (rp.chips ?? 0) > 0;
        }
        const player = await store.getPlayer(gp.playerId);
        if (player) {
          player.chips = gp.chips;
          player.isReady = this._isAIPlayer(rp || gp) && (gp.chips ?? 0) > 0;
          // Write the settled chips back; stores that hand out detached
          // copies (Redis JSON round-trip) would otherwise drop the
          // settlement silently.
          await this._persistPlayer(player);
        }
      }
      room.status = 'waiting';
      room.currentGameId = null;
      room.dealerPosition = game.dealerPosition;
      room.awaitingNextHandReady = true;
      // Persist the whole room: the players[] chip mutations above live on
      // nested entries that a partial update would never reach.
      await this._persistRoom(room);
    }

    await this._persistHandHistory(game);
  }

  /**
   * Best-effort hand history persistence. Only runs when the configured
   * store implements the optional saveHandHistory() method (the PostgreSQL
   * backend); one entry is written per seated player. Failures are logged
   * and swallowed — a history write must never break settlement.
   */
  async _persistHandHistory(game: PokerGame): Promise<void> {
    if (typeof store.saveHandHistory !== 'function') return;

    const showdownByPlayer = new Map(
      (game.showdownResults || []).map(r => [r.playerId, r])
    );
    const communityCards = game.communityCards.map(c => c.toString());
    const totalPot = game.pots.getTotalPot();

    for (const player of game.players) {
      try {
        const result = (game.handResults || []).find(r => r.playerId === player.playerId);
        const showdown = showdownByPlayer.get(player.playerId);
        await store.saveHandHistory({
          roomId: game.roomId,
          gameId: game.roomId, // games are keyed by roomId in the current engine
          playerId: player.playerId,
          nickname: player.nickname,
          holeCards: player.holeCards.map(c => c.toString()),
          handName: showdown ? showdown.handName : null,
          delta: result ? result.delta : 0,
          startingChips: player.startingChips,
          finalChips: player.chips,
          isWinner: result ? result.isWinner : false,
          summary: {
            seatPosition: player.seatPosition,
            folded: player.folded,
            communityCards,
            totalPot,
          },
          createdAt: Date.now(),
        });
      } catch (err) {
        console.error('[GameEngine] Failed to save hand history:', err);
      }
    }
  }

  _sanitizeGameState(game: PokerGame, includeHoleCards = false, viewerId: string | null = null): SanitizedGameState {
    const potData = game.pots.calculatePots();
    const isFinished = game.status === 'showdown' || game.status === 'ended';
    const activePlayers = game.players.filter(p => !p.folded);
    const shouldRevealAllInHands = activePlayers.length > 0 && activePlayers.every(p => p.allIn);

    return {
      status: game.status,
      communityCards: game.communityCards.map(c => c.toString()),
      pots: potData,
      totalPot: game.pots.getTotalPot(),
      currentBet: game.currentBet,
      minRaise: game.minRaise,
      dealerPosition: game.dealerPosition,
      smallBlindPos: game.smallBlindPos,
      bigBlindPos: game.bigBlindPos,
      currentPosition: game.currentPosition,
      currentPlayerId: game.players.find(p => p.seatPosition === game.currentPosition)?.playerId || null,
      players: game.players.map(p => ({
        playerId: p.playerId,
        nickname: p.nickname,
        avatar: p.avatar,
        seatPosition: p.seatPosition,
        chips: p.chips,
        startingChips: p.startingChips,
        bet: p.bet,
        totalBet: p.totalBet,
        folded: p.folded,
        allIn: p.allIn,
        holeCards: (includeHoleCards && !p.folded && (isFinished || shouldRevealAllInHands || p.playerId === viewerId)) ?
          p.holeCards.map(c => c.toString()) :
          null,
      })),
      winners: game.winners || null,
      handResults: game.handResults || null,
      showdownResults: game.showdownResults || null,
    };
  }

  _buildHandResults(game: PokerGame): GameHandResult[] {
    const winnerIds = new Set((game.winners || []).map(w => w.playerId));
    return game.players.map(player => ({
      playerId: player.playerId,
      position: player.seatPosition,
      nickname: player.nickname,
      chips: player.chips,
      startingChips: player.startingChips,
      delta: player.chips - player.startingChips,
      isWinner: winnerIds.has(player.playerId),
    }));
  }

  _buildShowdownResults(game: PokerGame): GameShowdownResult[] {
    const winnerIds = new Set((game.winners || []).map(w => w.playerId));
    return game.players
      .filter(player => !player.folded)
      .map(player => {
        const holeCards = Array.isArray(player.holeCards) ? player.holeCards : [];
        const allCards = [...holeCards, ...game.communityCards];
        let handName: string | null = null;
        if (allCards.length === 7) {
          const handResult = HandEvaluator.evaluate(allCards);
          handName = HAND_NAMES_CN[handResult.rank as keyof typeof HAND_NAMES_CN] || handResult.name;
        }
        return {
          playerId: player.playerId,
          position: player.seatPosition,
          nickname: player.nickname,
          cards: holeCards.map(c => c.toString()),
          handName,
          isWinner: winnerIds.has(player.playerId),
        };
      });
  }

  _isAIPlayer(player: MaybeAI): boolean {
    return Boolean(player && (
      player.isAI ||
      (typeof player.nickname === 'string' && player.nickname.startsWith('Bot-'))
    ));
  }

  /**
   * Write back a mutated room. The memory store hands out its live object,
   * so updateRoom() self-assigns there (a no-op); stores that return
   * detached copies (the Redis JSON round-trip) would otherwise silently
   * drop the settlement mutations. Failures are logged and rethrown — a
   * lost write must surface to the caller, never be swallowed.
   */
  async _persistRoom(room: RoomRecord): Promise<void> {
    try {
      await store.updateRoom(room.id, room);
    } catch (err) {
      console.error(`[GameEngine] Failed to persist room ${room.id}:`, err);
      throw err;
    }
  }

  /** Player counterpart of _persistRoom(); same write-through semantics. */
  async _persistPlayer(player: PlayerRecord): Promise<void> {
    try {
      await store.updatePlayer(player.id, player);
    } catch (err) {
      console.error(`[GameEngine] Failed to persist player ${player.id}:`, err);
      throw err;
    }
  }
}

/** Instance type for typed cross-service imports (erased at runtime). */
export type GameEngineService = GameEngine;

// Export the singleton instance exactly like the former .js module did;
// plain `module.exports =` stays runtime-safe under tsx/esbuild (see
// backend/storage/memory-store.ts for the detailed rationale).
module.exports = new GameEngine();
