/**
 * backend/services/game-engine.js - Texas Hold'em Game Engine
 *
 * Core game logic: dealing, betting rounds, showdown, pot distribution.
 * Server-authoritative - all state transitions happen here.
 */

const { Deck } = require('../domain/deck');
const { HandEvaluator } = require('../domain/hand-evaluator');
const { PotManager } = require('../domain/pot-manager');
const store = require('../storage/memory-store');
const {
  ACTION_TIMEOUT_MS,
  MIN_PLAYERS,
  MAX_SEATS,
} = require('../config/constants');

class GameEngine {
  async startGame(roomId) {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const seated = room.players.filter(p => p.seatPosition >= 0);
    if (seated.length < MIN_PLAYERS) {
      return { success: false, error: `Need at least ${MIN_PLAYERS} players` };
    }

    // Sort by seat position for deterministic processing
    seated.sort((a, b) => a.seatPosition - b.seatPosition);

    const initialChips = room.initialChips ?? 1000;

    // Create PotManager with initial seats
    const potSeats = seated.map(p => ({
      position: p.seatPosition,
      totalBet: 0,
      status: 'active',
      chips: p.chips ?? initialChips,
    }));

    const game = {
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
        chips: p.chips ?? initialChips,
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
      timeoutId: null,
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

    this._startTimeout(game);

    return {
      success: true,
      game: this._sanitizeGameState(game, false),
    };
  }

  async handleAction(roomId, playerId, action, amount = 0) {
    const game = await store.getGame(roomId);
    if (!game) return { success: false, error: 'No active game' };

    const player = game.players.find(p => p.playerId === playerId);
    if (!player) return { success: false, error: 'Not in game' };
    if (player.folded || player.allIn) return { success: false, error: 'Cannot act' };

    const currentPlayer = game.players.find(p => p.seatPosition === game.currentPosition);
    if (!currentPlayer || currentPlayer.playerId !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    if (game.timeoutId) {
      clearTimeout(game.timeoutId);
      game.timeoutId = null;
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
          game.currentBet = player.bet;
          // If all-in is a raise, set minRaise to the increment
          game.minRaise = Math.max(game.minRaise, player.bet - oldCurrentBet);
          game.actionsTaken.clear();
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
      this._nextPlayer(game);
      this._startTimeout(game);
    }

    return {
      success: true,
      game: this._sanitizeGameState(game, false),
    };
  }

  async getGameState(roomId, playerId) {
    const game = await store.getGame(roomId);
    if (!game) return null;
    return this._sanitizeGameState(game, true, playerId);
  }

  async getPrivateDeals(roomId) {
    const game = await store.getGame(roomId);
    if (!game) return [];

    return game.players.map(p => ({
      playerId: p.playerId,
      position: p.seatPosition,
      cards: p.holeCards.map(c => c.toJSON()),
    }));
  }

  async getAIDecisionContext(roomId, playerId) {
    const game = await store.getGame(roomId);
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

  async isPlayerTurn(roomId, playerId) {
    const game = await store.getGame(roomId);
    if (!game) return false;
    const player = game.players.find(p => p.seatPosition === game.currentPosition);
    return player && player.playerId === playerId;
  }

  async getValidActions(roomId, playerId) {
    const game = await store.getGame(roomId);
    if (!game) return [];
    return this._getValidActionsForGame(game, playerId);
  }

  async timeoutFold(roomId, seatPosition) {
    const game = await store.getGame(roomId);
    if (!game) return { success: false, error: 'No active game' };
    const player = game.players.find(p => p.seatPosition === seatPosition);
    if (!player) return { success: false, error: 'Player not found' };
    return this.handleAction(roomId, player.playerId, 'fold');
  }

  async playerDisconnect(roomId, playerId) {
    const game = await store.getGame(roomId);
    if (!game) return { success: false, error: 'No active game' };
    const player = game.players.find(p => p.playerId === playerId);
    if (!player || player.folded || player.allIn) {
      return { success: false, error: 'Cannot act for player' };
    }
    return this.handleAction(roomId, playerId, 'fold');
  }

  async nextHand(roomId) {
    const room = await store.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    // Persist dealer position for next hand rotation
    const game = store.getGame(roomId);
    if (game) {
      room.dealerPosition = game.dealerPosition;
      store.deleteGame(roomId);
    }

    // Reset players who are still seated but have 0 chips
    for (const p of room.players) {
      if (p.seatPosition >= 0 && p.chips <= 0) {
        p.chips = room.initialChips ?? 1000;
      }
    }

    room.status = 'waiting';
    return { success: true, room };
  }

  // ─── Internal ──────────────────────────────────────────────────

  _getNextDealerPosition(room, seated) {
    if (!room.dealerPosition && room.dealerPosition !== 0) {
      return seated[0].seatPosition;
    }
    const occupied = seated.map(p => p.seatPosition).sort((a, b) => a - b);
    return this._findNextActiveSeat(room.dealerPosition, occupied);
  }

  _getBlindPositions(dealerPosition, occupiedPositions) {
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

  _findNextActiveSeat(fromPosition, occupiedPositions) {
    if (!occupiedPositions || occupiedPositions.length === 0) return null;
    const sorted = [...occupiedPositions].sort((a, b) => a - b);
    const idx = sorted.findIndex(pos => pos > fromPosition);
    return idx === -1 ? sorted[0] : sorted[idx];
  }

  _findPreviousActiveSeat(fromPosition, occupiedPositions) {
    if (!occupiedPositions || occupiedPositions.length === 0) return null;
    const sorted = [...occupiedPositions].sort((a, b) => a - b);
    const idx = sorted.findLastIndex(pos => pos < fromPosition);
    return idx === -1 ? sorted[sorted.length - 1] : sorted[idx];
  }

  _placeBet(game, player, amount) {
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

  _getValidActionsForGame(game, playerId) {
    const player = game.players.find(p => p.playerId === playerId);
    if (!player || player.folded || player.allIn) return [];
    const currentPlayer = game.players.find(p => p.seatPosition === game.currentPosition);
    if (!currentPlayer || currentPlayer.playerId !== playerId) return [];

    const toCall = game.currentBet - player.bet;
    const actions = [];

    if (toCall === 0) {
      actions.push({ type: 'check' });
      actions.push({
        type: 'bet',
        minAmount: game.minRaise,
        maxAmount: player.chips,
      });
    } else {
      actions.push({ type: 'fold' });
      if (player.chips <= toCall) {
        actions.push({ type: 'allin' });
      } else {
        actions.push({
          type: 'call',
          amount: toCall,
        });
        actions.push({
          type: 'raise',
          minAmount: game.currentBet + game.minRaise,
          maxAmount: player.chips + player.bet,
        });
      }
    }

    if (player.chips > 0) {
      actions.push({ type: 'allin' });
    }

    return actions;
  }

  _buildLegalActions(game, playerId) {
    const player = game.players.find(p => p.playerId === playerId);
    const validActions = this._getValidActionsForGame(game, playerId);
    const actions = [];
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

  _buildPositionContext(game, playerId) {
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

  _buildPotOdds(game, playerId) {
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

  _createActionHistory() {
    return {
      preflop: [],
      flop: [],
      turn: [],
      river: [],
    };
  }

  _recordAction(game, player, action, amount) {
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

  _sanitizeActionHistory(game) {
    const source = game.actionHistory || this._createActionHistory();
    const history = this._createActionHistory();
    for (const street of Object.keys(history)) {
      history[street] = (source[street] || []).map(item => ({ ...item }));
    }
    return history;
  }

  _streetKey(status) {
    return ['preflop', 'flop', 'turn', 'river'].includes(status) ? status : null;
  }

  _roundRatio(value) {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(4));
  }

  async _nextPlayer(game) {
    const occupiedPositions = game.players.map(p => p.seatPosition).sort((a, b) => a - b);
    const active = game.players.filter(p => !p.folded && !p.allIn);
    if (active.length <= 1) {
      await this._advancePhase(game);
      return;
    }

    const startPos = game.currentPosition;
    let nextPos = game.currentPosition;
    do {
      nextPos = this._findNextActiveSeat(nextPos, occupiedPositions);
    } while (
      nextPos !== startPos &&
      nextPos !== null &&
      (game.players.find(p => p.seatPosition === nextPos)?.folded ||
        game.players.find(p => p.seatPosition === nextPos)?.allIn)
    );

    game.currentPosition = nextPos;
  }

  async _isRoundComplete(game) {
    const active = game.players.filter(p => !p.folded);
    if (active.length <= 1) return true;

    const nonAllIn = active.filter(p => !p.allIn);
    if (nonAllIn.length === 0) return true;

    const allActed = nonAllIn.every(p => game.actionsTaken.has(p.playerId));
    if (!allActed) return false;

    return nonAllIn.every(p => p.bet === game.currentBet);
  }

  async _advancePhase(game) {
    const room = await store.getRoom(game.roomId);
    const bigBlind = room ? room.bigBlind : 20;

    // Clear current round bets (PotManager already tracks total bets via _placeBet)
    for (const player of game.players) {
      player.bet = 0;
    }
    game.currentBet = 0;
    game.minRaise = bigBlind;
    game.actionsTaken.clear();

    if (game.timeoutId) {
      clearTimeout(game.timeoutId);
      game.timeoutId = null;
    }

    const active = game.players.filter(p => !p.folded);
    if (active.length <= 1) {
      await this._showdown(game);
      return;
    }

    // If everyone left is all-in, skip to showdown
    if (active.every(p => p.allIn)) {
      // Deal remaining community cards if needed
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
    this._startTimeout(game);
  }

  async _showdown(game) {
    game.status = 'showdown';
    const activePlayers = game.players.filter(p => !p.folded);

    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const totalPot = game.pots.getTotalPot();
      winner.chips += totalPot;
      game.winners = [{ playerId: winner.playerId, amount: totalPot, hand: 'All others folded' }];
    } else {
      // Use PotManager's distribute method
      const handResults = activePlayers.map(player => {
        const hand = [...player.holeCards, ...game.communityCards];
        return {
          position: player.seatPosition,
          handResult: HandEvaluator.evaluate(hand),
        };
      });

      const payouts = game.pots.distribute(handResults, (a, b) => {
        return HandEvaluator.compare(a.handResult, b.handResult);
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
              amount,
              hand: hr ? hr.handResult.name : 'Unknown',
            });
          }
        }
      }
    }

    game.status = 'ended';

    if (game.timeoutId) {
      clearTimeout(game.timeoutId);
      game.timeoutId = null;
    }

    const room = await store.getRoom(game.roomId);
    if (room) {
      for (const gp of game.players) {
        const rp = room.players.find(p => p.playerId === gp.playerId);
        if (rp) rp.chips = gp.chips;
        const player = await store.getPlayer(gp.playerId);
        if (player) player.chips = gp.chips;
      }
      room.status = 'waiting';
      await store.updateRoom(game.roomId, { status: 'waiting' });
    }
  }

  _startTimeout(game) {
    if (game.timeoutId) clearTimeout(game.timeoutId);
    const currentPlayer = game.players.find(p => p.seatPosition === game.currentPosition);
    if (!currentPlayer) return;

    game.timeoutId = setTimeout(() => {
      this.timeoutFold(game.roomId, currentPlayer.seatPosition);
    }, ACTION_TIMEOUT_MS);
  }

  _sanitizeGameState(game, includeHoleCards = false, viewerId = null) {
    const potData = game.pots.calculatePots();
    const isFinished = game.status === 'showdown' || game.status === 'ended';

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
        bet: p.bet,
        totalBet: p.totalBet,
        folded: p.folded,
        allIn: p.allIn,
        holeCards: (includeHoleCards && (isFinished || p.playerId === viewerId)) ?
          p.holeCards.map(c => c.toString()) :
          null,
      })),
      winners: game.winners || null,
    };
  }
}

module.exports = new GameEngine();
