/**
 * game-roster.ts - Helpers for seeding and restoring the game store's
 * player-related state without a game:state event.
 *
 * Normal hand starts never emit game:state, so the game store cannot rely
 * on the authoritative snapshot to learn who sits at the table: the roster
 * is synthesized from the room snapshot instead, and per-player chip/bet
 * updates then merge by playerId from game:pot / game:action events.
 */

import type {
  CardJSON,
  CardString,
  GamePlayer,
  OccupiedSeatInfo,
  RoomState,
} from '@/types'
import { parseCardStrings } from '@/utils/card-string'

/**
 * Build the initial roster for a fresh hand from the occupied seats of the
 * current room. Betting fields start clean; the trailing game:pot snapshot
 * refreshes chips/bets. Without a room snapshot (unit tests, desync) fall
 * back to the previous roster with per-hand flags reset.
 */
export function synthesizeRoster(
  room: RoomState | null,
  previous: GamePlayer[],
): GamePlayer[] {
  if (!room) {
    return previous.map(player => ({
      ...player,
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      holeCards: null,
    }))
  }
  return room.seats
    .filter((seat): seat is OccupiedSeatInfo => seat.status === 'occupied')
    .map(seat => ({
      playerId: seat.playerId,
      nickname: seat.nickname,
      avatar: seat.avatar,
      seatPosition: seat.position,
      chips: seat.chips,
      startingChips: seat.chips,
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      holeCards: null,
    }))
}

/**
 * Decide the viewer's hole cards from a game:state snapshot. A real card
 * list always wins (reconnect restore, showdown reveal). A null viewer view
 * must not wipe the privately dealt cards while the hand is still live;
 * only after the hand (showdown/ended) does it clear them.
 */
export function resolveHoleCards(
  snapshot: CardString[] | null,
  held: CardJSON[],
  handActive: boolean,
): CardJSON[] {
  if (Array.isArray(snapshot)) {
    return parseCardStrings(snapshot)
  }
  return handActive && held.length > 0 ? held : []
}
