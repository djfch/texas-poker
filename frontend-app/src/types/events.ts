/**
 * events.ts - Socket.IO event names and per-event payload types.
 *
 * Constants mirror backend/socket/events.js one-to-one. Payload types mirror
 * the emit sites in backend/socket/handlers.js.
 */

import type {
  CardJSON,
  CardString,
  GameActionType,
  GameState,
  HandResultEntry,
  PlayerIdentity,
  RoomState,
  Settlement,
  ShowdownEntry,
  SidePot,
  ValidAction,
  WinnerInfo,
} from './payloads'

// ─── Event name constants (mirror backend/socket/events.js) ──────

/** Client -> Server */
export const WS_CLIENT_EVENTS = {
  JOIN_ROOM: 'room:join',
  LEAVE_ROOM: 'room:leave',
  SIT: 'seat:sit',
  STAND: 'seat:stand',
  READY: 'room:ready',
  BORROW_CHIPS: 'room:borrow_chips',
  ADD_AI: 'room:add_ai',
  REMOVE_AI: 'room:remove_ai',
  START_GAME: 'room:start',
  UPDATE_NICKNAME: 'player:update_nickname',
  GAME_ACTION: 'game:action',
  CHAT_MESSAGE: 'chat:message',
  REQUEST_STATE: 'game:request_state',
} as const

/**
 * Server -> Client.
 * Note: backend events.js has no CONNECTED key; handlers.js emits
 * `EVENTS.SERVER.CONNECTED || 'connected'`, so the wire name is 'connected'.
 * PLAYER_SAT / PLAYER_STOOD exist in events.js but are never emitted by the
 * current handlers.js; they are kept here for parity with the backend table.
 */
export const WS_SERVER_EVENTS = {
  CONNECTED: 'connected',
  ROOM_STATE: 'room:state',
  PLAYER_JOINED: 'player:joined',
  PLAYER_LEFT: 'player:left',
  PLAYER_READY: 'player:ready',
  PLAYER_UPDATED: 'player:updated',
  ROOM_SETTLEMENT: 'room:settlement',
  ROOM_SETTLED: 'room:settled',
  PLAYER_SAT: 'player:sat',
  PLAYER_STOOD: 'player:stood',
  GAME_STARTED: 'game:started',
  GAME_DEALT: 'game:dealt',
  GAME_COMMUNITY: 'game:community',
  GAME_TURN: 'game:turn',
  GAME_ACTION: 'game:action',
  GAME_POT: 'game:pot',
  GAME_SHOWDOWN: 'game:showdown',
  GAME_ENDED: 'game:ended',
  GAME_STATE: 'game:state',
  CHAT_MESSAGE: 'chat:message',
  ERROR: 'error',
} as const

export type WsClientEvent = (typeof WS_CLIENT_EVENTS)[keyof typeof WS_CLIENT_EVENTS]
export type WsServerEvent = (typeof WS_SERVER_EVENTS)[keyof typeof WS_SERVER_EVENTS]

// ─── Client -> Server payloads ───────────────────────────────────

export interface JoinRoomPayload {
  roomId: string
  password?: string
}

export interface SitPayload {
  position: number
}

export interface ReadyPayload {
  ready: boolean
}

export interface RemoveAiPayload {
  position: number
}

export interface UpdateNicknamePayload {
  nickname: string
}

export interface GameActionRequestPayload {
  type: GameActionType
  amount?: number
}

export interface ChatSendPayload {
  text: string
}

// ─── Server -> Client payloads ───────────────────────────────────

/** 'connected' — handlers._buildConnectedPayload. */
export interface ConnectedPayload {
  playerId: string
  player: PlayerIdentity
  /** Guest token issued when the server silently created this player. */
  token?: string
}

/** 'error' — { error } always; { code: 'PLAYER_UNKNOWN' } on stale identity. */
export interface ServerErrorPayload {
  error: string
  code?: string
}

export interface RoomStatePayload {
  room: RoomState
}

/** 'player:joined' — seat.position is -1 when the player has not sat yet. */
export interface PlayerJoinedPayload {
  seat: {
    position: number
    playerId: string
    nickname: string
    avatar: string
    isReady: boolean
  }
}

export interface PlayerLeftPayload {
  position: number
}

export interface PlayerReadyPayload {
  position: number
  ready: boolean
}

/**
 * 'player:updated' — to self: { player }; to room: { playerId, player }.
 * player is the full stored player record (superset of PlayerIdentity).
 */
export interface PlayerUpdatedPayload {
  playerId?: string
  player: PlayerIdentity
}

/** 'room:settlement' — personal settlement on leave (or borrow, type='borrow'). */
export interface RoomSettlementPayload {
  roomId: string
  settlement: Settlement
  roomDeleted?: boolean
  type?: string
}

/** 'room:settled' — broadcast when the host leaves and the room is closed. */
export interface RoomSettledPayload {
  roomId: string
  settlements: Settlement[]
  roomDeleted: boolean
  reason?: string
}

export interface GameStartedPayload {
  gameId: string
  dealer: number
  sb: number
  bb: number
}

/** 'game:dealt' — private, only sent to the card owner. */
export interface GameDealtPayload {
  cards: CardJSON[]
  position: number
}

export interface GameCommunityPayload {
  cards: CardString[]
  round: string
}

/**
 * 'game:turn' — the acting player receives a private copy with validActions,
 * then everyone (including the actor) receives a public copy without it.
 */
export interface GameTurnPayload {
  position: number
  timeoutAt: number
  validActions?: ValidAction[]
  currentBet: number
  minRaise: number
  totalPot: number
}

export interface GameActionNotifyPayload {
  position: number
  type: GameActionType
  amount: number
}

export interface GamePotPlayer {
  playerId: string
  position: number
  chips: number
  bet: number
  totalBet: number
  allIn: boolean
}

export interface GamePotPayload {
  mainPot: number
  sidePots: SidePot[]
  totalPot: number
  players: GamePotPlayer[]
}

export interface GameShowdownPayload {
  results: ShowdownEntry[]
}

export interface GameEndedPayload {
  winners: WinnerInfo[]
  handResults: HandResultEntry[]
  nextHandDelay: number
}

export interface GameStatePayload {
  gameState: GameState
}

export interface ChatMessagePayload {
  from: string
  text: string
  timestamp: number
}
