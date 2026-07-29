/**
 * payloads.ts - Wire payload types for the Texas Hold'em backend contract.
 *
 * Every shape here mirrors the actual backend serializers:
 * - REST: backend/routes/auth.js, backend/routes/rooms.js
 * - Room: backend/services/room-manager.js (_sanitizeRoom, _buildSeatArray,
 *   _buildSettlement)
 * - Game: backend/services/game-engine.js (_sanitizeGameState,
 *   _buildLegalActions, _buildShowdownResults, _buildHandResults)
 * - WS events: backend/socket/handlers.js emit sites
 *
 * Field names are camelCase for game/room state (backend sanitize output),
 * snake_case only where the backend itself uses it (LegalActions).
 */

// ─── Cards ───────────────────────────────────────────────────────

export type CardSuit = 'hearts' | 'diamonds' | 'clubs' | 'spades'
export type CardRank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A'

/** Structured card, used by game:dealt (Card.toJSON()). */
export interface CardJSON {
  suit: CardSuit
  rank: CardRank
}

/**
 * Display string card, e.g. 'A♠' or '10♥' (Card.toString()).
 * Used in game:state communityCards/holeCards and showdown results.
 */
export type CardString = string

// ─── Shared ──────────────────────────────────────────────────────

export interface PlayerIdentity {
  id: string
  nickname: string
  avatar: string
  chips: number
}

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status?: number }

// ─── REST bodies (the raw JSON body, wrapped by api into ApiResult.data) ──

export interface PlayerResponseBody {
  success: boolean
  player?: PlayerIdentity
  /** Server-signed JWT (guest or user token), present since P3 auth. */
  token?: string
  error?: string
}

export interface RoomsResponseBody {
  success: boolean
  rooms?: RoomState[]
  error?: string
}

export interface RoomResponseBody {
  success: boolean
  room?: RoomState
  error?: string
}

/** POST /api/rooms/:id/join resolves to { success, room } on HTTP 200. */
export type JoinRoomResponseBody = RoomResponseBody

export interface CreateRoomConfig {
  name?: string
  maxPlayers?: number
  smallBlind?: number
  bigBlind?: number
  initialChips?: number
  allowAI?: boolean
  isPrivate?: boolean
  password?: string
}

// ─── Room (room-manager._sanitizeRoom output) ────────────────────

export type RoomStatus = 'waiting' | 'playing' | 'ended'

export interface RoomPlayer {
  playerId: string
  nickname: string
  avatar: string
  seatPosition: number
  isReady: boolean
  chips: number
  buyInTotal: number
  borrowCount: number
  netResult: number
  isAI: boolean
}

export interface OccupiedSeatInfo {
  position: number
  status: 'occupied'
  playerId: string
  nickname: string
  avatar: string
  isReady: boolean
  chips: number
  buyInTotal: number
  borrowCount: number
  netResult: number
  isAI: boolean
}

export interface EmptySeatInfo {
  position: number
  status: 'empty'
}

export type SeatInfo = OccupiedSeatInfo | EmptySeatInfo

export interface RoomState {
  id: string
  name: string
  hostId: string
  maxPlayers: number
  smallBlind: number
  bigBlind: number
  initialChips: number
  allowAI: boolean
  isPrivate: boolean
  status: RoomStatus
  playerCount: number
  seatedCount: number
  createdAt: number
  dealerPosition: number
  awaitingNextHandReady: boolean
  seats: SeatInfo[]
  players: RoomPlayer[]
}

/** room-manager._buildSettlement output (leave/borrow/host-left). */
export interface Settlement {
  playerId: string
  nickname: string
  seatPosition: number
  chips: number
  buyInTotal: number
  borrowCount: number
  netResult: number
}

// ─── Game (game-engine._sanitizeGameState output) ────────────────

export type GameStatus = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'ended'

export interface SidePot {
  amount: number
  eligiblePositions: number[]
}

export interface PotBreakdown {
  mainPot: number
  sidePots: SidePot[]
}

export interface GamePlayer {
  playerId: string
  nickname: string
  avatar: string
  seatPosition: number
  chips: number
  startingChips: number
  bet: number
  totalBet: number
  folded: boolean
  allIn: boolean
  /** Revealed only at showdown / all-in runout / to the owner; else null. */
  holeCards: CardString[] | null
}

export interface WinnerInfo {
  playerId: string
  position: number
  nickname: string
  amount: number
  payout: number
  hand: string
}

export interface HandResultEntry {
  playerId: string
  position: number
  nickname: string
  chips: number
  startingChips: number
  delta: number
  isWinner: boolean
}

/** game-engine._buildShowdownResults entry (final showdown). */
export interface ShowdownResult {
  playerId: string
  position: number
  nickname: string
  cards: CardString[]
  handName: string | null
  isWinner: boolean
}

/**
 * handlers._buildVisibleHoleCardResults entry (all-in runout reveal).
 * Same wire shape minus nickname/isWinner.
 */
export interface RevealedHoleCards {
  position: number
  playerId: string
  cards: CardString[]
  handName: string | null
}

export type ShowdownEntry = ShowdownResult | RevealedHoleCards

export interface GameState {
  status: GameStatus
  communityCards: CardString[]
  pots: PotBreakdown
  totalPot: number
  currentBet: number
  minRaise: number
  dealerPosition: number
  smallBlindPos: number
  bigBlindPos: number
  currentPosition: number | null
  currentPlayerId: string | null
  players: GamePlayer[]
  winners: WinnerInfo[] | null
  handResults: HandResultEntry[] | null
  showdownResults: ShowdownResult[] | null
}

// ─── Betting actions ─────────────────────────────────────────────

export type GameActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'

/** One entry of the validActions array in the private game:turn event. */
export type ValidAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'allin' }
  | { type: 'call'; amount: number }
  | { type: 'bet' | 'raise'; minAmount: number; maxAmount: number }

/** game-engine._buildLegalActions output (snake_case, AI context only). */
export interface LegalActions {
  actions: GameActionType[]
  to_call: number
  min_raise: number
  max_raise: number
}
