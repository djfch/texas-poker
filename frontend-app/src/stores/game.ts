/**
 * game.ts - Game (hand) state store.
 *
 * Maintains the current hand from game:* socket events:
 * - game:started / dealt / community / turn / action / pot / showdown / ended
 *   drive incremental transitions;
 * - game:state is the authoritative full-sync used after (re)connect;
 * - normal starts never emit game:state, so the roster is synthesized from
 *   the room snapshot (stores/game-roster.ts).
 *
 * Mirrors the legacy frontend/js/views/table.js semantics: the acting
 * player receives a private game:turn with validActions and then the public
 * copy without them, so validActions are only overwritten when present and
 * cleared when the turn moves on (game:state keeps them while the snapshot
 * still shows my turn).
 *
 * Pure state and transition logic only - no DOM, no animation.
 */

import { defineStore } from 'pinia'
import type {
  CardJSON,
  CardString,
  GameActionNotifyPayload,
  GameCommunityPayload,
  GameDealtPayload,
  GameEndedPayload,
  GamePlayer,
  GamePotPayload,
  GameShowdownPayload,
  GameStartedPayload,
  GameState,
  GameStatus,
  GameTurnPayload,
  HandResultEntry,
  PotBreakdown,
  ShowdownEntry,
  ValidAction,
  WinnerInfo,
} from '@/types'
import { usePlayerStore } from '@/stores/player'
import { useRoomStore } from '@/stores/room'
import { resolveHoleCards, synthesizeRoster } from '@/stores/game-roster'

interface GameStoreState {
  /** Id of the current hand, from game:started; null between hands. */
  gameId: string | null
  status: GameStatus | null
  communityCards: CardString[]
  pots: PotBreakdown
  totalPot: number
  currentBet: number
  minRaise: number
  dealerPosition: number | null
  smallBlindPos: number | null
  bigBlindPos: number | null
  currentPosition: number | null
  currentPlayerId: string | null
  turnTimeoutAt: number | null
  /** Private valid actions for the acting player (me), empty otherwise. */
  validActions: ValidAction[]
  players: GamePlayer[]
  /** My hole cards (structured), from game:dealt or game:state restore. */
  myHoleCards: CardJSON[]
  mySeatPosition: number | null
  /**
   * Monotonic counter bumped by every game:state full sync. Never reset:
   * watchers compare it to tell an authoritative restore (skip animations)
   * from a live deal/street transition, which a null->status comparison
   * cannot do once started/dealt coalesce into one flush.
   */
  restoreSeq: number
  showdownResults: ShowdownEntry[]
  winners: WinnerInfo[] | null
  handResults: HandResultEntry[] | null
  nextHandDelay: number | null
  lastAction: GameActionNotifyPayload | null
  /**
   * Recent finished hands, most-recent-first, capped at MAX_HAND_HISTORY.
   * Accumulated on game:ended so the history drawer keeps content across the
   * next hand start (which clears the live showdown/handResults fields).
   */
  handHistory: HandHistoryRecord[]
}

const EMPTY_POTS: PotBreakdown = { mainPot: 0, sidePots: [] }

/** Max number of finished hands retained client-side for the history drawer. */
export const MAX_HAND_HISTORY = 20

/** One finished-hand snapshot shown in the history drawer. */
export interface HandHistoryRecord {
  gameId: string | null
  endedAt: number
  showdown: ShowdownEntry[]
  results: HandResultEntry[]
  winners: WinnerInfo[]
}

export const useGameStore = defineStore('game', {
  state: (): GameStoreState => ({
    gameId: null,
    status: null,
    communityCards: [],
    pots: { ...EMPTY_POTS, sidePots: [] },
    totalPot: 0,
    currentBet: 0,
    minRaise: 0,
    dealerPosition: null,
    smallBlindPos: null,
    bigBlindPos: null,
    currentPosition: null,
    currentPlayerId: null,
    turnTimeoutAt: null,
    validActions: [],
    players: [],
    myHoleCards: [],
    mySeatPosition: null,
    restoreSeq: 0,
    showdownResults: [],
    winners: null,
    handResults: null,
    nextHandDelay: null,
    lastAction: null,
    handHistory: [],
  }),

  getters: {
    isMyTurn(state): boolean {
      return (
        state.mySeatPosition !== null &&
        state.currentPosition !== null &&
        state.currentPosition === state.mySeatPosition
      )
    },
    me(state): GamePlayer | null {
      if (state.mySeatPosition === null) return null
      return state.players.find(p => p.seatPosition === state.mySeatPosition) ?? null
    },
    isHandActive(state): boolean {
      return (
        state.status !== null && state.status !== 'showdown' && state.status !== 'ended'
      )
    },
  },

  actions: {
    /** Clear every per-hand field (leave room / before a fresh restore). */
    resetGame(): void {
      this.gameId = null
      this.status = null
      this.communityCards = []
      this.pots = { mainPot: 0, sidePots: [] }
      this.totalPot = 0
      this.currentBet = 0
      this.minRaise = 0
      this.dealerPosition = null
      this.smallBlindPos = null
      this.bigBlindPos = null
      this.currentPosition = null
      this.currentPlayerId = null
      this.turnTimeoutAt = null
      this.validActions = []
      this.players = []
      this.myHoleCards = []
      this.mySeatPosition = null
      this.showdownResults = []
      this.winners = null
      this.handResults = null
      this.nextHandDelay = null
      this.lastAction = null
      this.handHistory = []
    },

    /**
     * game:started — a new hand begins. Positions come from the payload; all
     * per-hand data is cleared. The server-side status of a fresh game is
     * 'preflop' (game-engine sets it at creation, before any game:community).
     * No game:state follows a normal start, so the roster is synthesized
     * from the room snapshot; my seat stays unbound until game:dealt.
     */
    handleGameStarted(data: GameStartedPayload): void {
      this.gameId = data.gameId
      this.status = 'preflop'
      this.communityCards = []
      this.pots = { mainPot: 0, sidePots: [] }
      this.totalPot = 0
      this.currentBet = 0
      this.minRaise = 0
      this.dealerPosition = data.dealer
      this.smallBlindPos = data.sb
      this.bigBlindPos = data.bb
      this.currentPosition = null
      this.currentPlayerId = null
      this.turnTimeoutAt = null
      this.validActions = []
      this.myHoleCards = []
      this.mySeatPosition = null
      this.showdownResults = []
      this.winners = null
      this.handResults = null
      this.nextHandDelay = null
      this.lastAction = null
      // Seed the roster from the room snapshot; game:pot / game:action
      // merges then update it by playerId/seat (see game-roster.ts).
      this.players = synthesizeRoster(useRoomStore().room, this.players)
    },

    /** game:dealt — private hole cards for this client. */
    handleGameDealt(data: GameDealtPayload): void {
      if (typeof data.position === 'number') {
        this.mySeatPosition = data.position
      }
      if (Array.isArray(data.cards)) {
        this.myHoleCards = data.cards
      }
    },

    /** game:community — full community card list for the new street. */
    handleGameCommunity(data: GameCommunityPayload): void {
      this.communityCards = data.cards
      if (
        data.round === 'preflop' ||
        data.round === 'flop' ||
        data.round === 'turn' ||
        data.round === 'river'
      ) {
        this.status = data.round
      }
    },

    /**
     * game:turn — updates the acting seat and betting context. The private
     * copy carries validActions; the public copy does not, so actions are
     * only replaced when present and cleared when the turn moves on.
     */
    handleGameTurn(data: GameTurnPayload): void {
      this.currentPosition = data.position
      this.turnTimeoutAt = data.timeoutAt ?? null
      this.currentBet = data.currentBet ?? 0
      this.minRaise = data.minRaise ?? 0
      this.totalPot = data.totalPot ?? this.totalPot
      this.currentPlayerId =
        this.players.find(p => p.seatPosition === data.position)?.playerId ?? null

      if (data.position === this.mySeatPosition) {
        if (data.validActions) {
          this.validActions = data.validActions
        }
      } else {
        this.validActions = []
      }
    },

    /** game:action — remember the latest action; fold/all-in flag the seat. */
    handleGameAction(data: GameActionNotifyPayload): void {
      this.lastAction = data
      const player = this.players.find(p => p.seatPosition === data.position)
      if (!player) return
      if (data.type === 'fold') player.folded = true
      if (data.type === 'allin') player.allIn = true
    },

    /** game:pot — pot breakdown plus per-player chip/bet snapshots. */
    handleGamePot(data: GamePotPayload): void {
      this.pots = { mainPot: data.mainPot, sidePots: data.sidePots ?? [] }
      this.totalPot = data.totalPot
      if (!Array.isArray(data.players)) return
      for (const snapshot of data.players) {
        const player = this.players.find(p => p.playerId === snapshot.playerId)
        if (!player) continue
        player.chips = snapshot.chips
        player.bet = snapshot.bet
        player.totalBet = snapshot.totalBet
        player.allIn = snapshot.allIn
      }
    },

    /** game:showdown — revealed hands (final results or all-in runout). */
    handleGameShowdown(data: GameShowdownPayload): void {
      this.showdownResults = data.results ?? []
      this.status = 'showdown'
    },

    /** game:ended — hand over; winners and per-player deltas. */
    handleGameEnded(data: GameEndedPayload): void {
      const winners = data.winners ?? []
      const results = data.handResults ?? []
      this.winners = winners
      this.handResults = results
      this.nextHandDelay = data.nextHandDelay ?? null
      this.status = 'ended'
      this.validActions = []
      this.currentPosition = null
      this.currentPlayerId = null
      this.turnTimeoutAt = null
      // Snapshot the finished hand so the history drawer keeps content once
      // the next game:started clears the live showdown/handResults fields.
      this.handHistory.unshift({
        gameId: this.gameId,
        endedAt: Date.now(),
        showdown: [...this.showdownResults],
        results,
        winners,
      })
      if (this.handHistory.length > MAX_HAND_HISTORY) {
        this.handHistory.length = MAX_HAND_HISTORY
      }
    },

    /**
     * game:state — authoritative full sync (join / reconnect). Re-derives my
     * seat and hole cards, keeping dealt cards against a null viewer view
     * while the hand is live, and keeps validActions while it is my turn.
     */
    handleGameState(gameState: GameState): void {
      this.restoreSeq += 1
      this.status = gameState.status
      this.communityCards = gameState.communityCards ?? []
      this.pots = gameState.pots ?? { mainPot: 0, sidePots: [] }
      this.totalPot = gameState.totalPot ?? 0
      this.currentBet = gameState.currentBet ?? 0
      this.minRaise = gameState.minRaise ?? 0
      this.dealerPosition = gameState.dealerPosition ?? null
      this.smallBlindPos = gameState.smallBlindPos ?? null
      this.bigBlindPos = gameState.bigBlindPos ?? null
      this.currentPosition = gameState.currentPosition ?? null
      this.currentPlayerId = gameState.currentPlayerId ?? null
      this.players = gameState.players ?? []
      this.winners = gameState.winners ?? null
      this.handResults = gameState.handResults ?? null
      this.showdownResults = gameState.showdownResults ?? []

      const me = this.players.find(p => p.playerId === usePlayerStore().playerId)
      if (me) {
        this.mySeatPosition = me.seatPosition
        this.myHoleCards = resolveHoleCards(me.holeCards, this.myHoleCards, this.isHandActive)
      }
      if (gameState.currentPosition !== this.mySeatPosition) this.validActions = []
    },
  },
})
