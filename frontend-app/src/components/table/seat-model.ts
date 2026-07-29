/**
 * seat-model.ts - Merge room seats and game players into per-seat view
 * models for the table view. Pure mapping (no store imports): the view
 * passes store snapshots in and renders the result.
 *
 * Merge rules mirror legacy frontend/js/views/table.js:
 * - identity (nickname/avatar/isAI) comes from the room seat,
 * - chips/bet/folded/allIn come from the game player when present,
 * - revealed cards and hand names come from showdown results (falling back
 *   to public holeCards in game:state after showdown/ended),
 * - per-seat deltas come from hand results (game:ended),
 * - "thinking" marks the acting seat when it belongs to an AI/bot.
 */

import type {
  CardString,
  GamePlayer,
  GameStatus,
  HandResultEntry,
  SeatInfo,
  ShowdownEntry,
} from '@/types'

export interface TableSeatModel {
  seatIndex: number
  empty: boolean
  nickname: string
  avatar: string
  chips: number
  /** Current-street bet (the chip circle in front of the seat). */
  bet: number
  isMe: boolean
  isAI: boolean
  isDealer: boolean
  isSmallBlind: boolean
  isBigBlind: boolean
  isCurrentTurn: boolean
  folded: boolean
  allIn: boolean
  thinking: boolean
  /** Revealed hole cards at showdown / all-in runout; null otherwise. */
  revealedCards: CardString[] | null
  handName: string | null
  /** Signed per-hand delta once the hand ended; null while playing. */
  resultDelta: number | null
  isWinner: boolean
}

export interface BuildSeatModelsInput {
  maxPlayers: number
  roomSeats: SeatInfo[]
  gamePlayers: GamePlayer[]
  myPlayerId: string | null
  dealerPosition: number | null
  smallBlindPos: number | null
  bigBlindPos: number | null
  currentPosition: number | null
  status: GameStatus | null
  showdownResults: ShowdownEntry[]
  handResults: HandResultEntry[] | null
}

function findShowdownEntry(
  results: ShowdownEntry[],
  position: number,
): ShowdownEntry | undefined {
  return results.find(r => r.position === position)
}

export function buildSeatModels(input: BuildSeatModelsInput): TableSeatModel[] {
  const {
    maxPlayers,
    roomSeats,
    gamePlayers,
    myPlayerId,
    status,
    showdownResults,
    handResults,
  } = input
  const revealPhase = status === 'showdown' || status === 'ended'

  const models: TableSeatModel[] = []
  for (let pos = 0; pos < maxPlayers; pos++) {
    const roomSeat = roomSeats.find(s => s.position === pos)
    const occupied = roomSeat?.status === 'occupied' ? roomSeat : null
    const gamePlayer = gamePlayers.find(p => p.seatPosition === pos) ?? null
    const empty = !occupied && !gamePlayer

    const nickname = occupied?.nickname ?? gamePlayer?.nickname ?? ''
    const isAI = occupied?.isAI ?? false
    const isMe = Boolean(
      !empty && (occupied?.playerId ?? gamePlayer?.playerId) === myPlayerId,
    )
    const isCurrentTurn = input.currentPosition === pos

    const showdownEntry = findShowdownEntry(showdownResults, pos)
    let revealedCards: CardString[] | null = null
    if (showdownEntry?.cards?.length) {
      revealedCards = showdownEntry.cards
    } else if (revealPhase && gamePlayer?.holeCards?.length) {
      revealedCards = gamePlayer.holeCards
    }

    const handResult = handResults?.find(h => h.position === pos) ?? null

    models.push({
      seatIndex: pos,
      empty,
      nickname,
      avatar: occupied?.avatar ?? gamePlayer?.avatar ?? '',
      chips: gamePlayer?.chips ?? occupied?.chips ?? 0,
      bet: gamePlayer?.bet ?? 0,
      isMe,
      isAI,
      isDealer: input.dealerPosition === pos,
      isSmallBlind: input.smallBlindPos === pos,
      isBigBlind: input.bigBlindPos === pos,
      isCurrentTurn,
      folded: gamePlayer?.folded ?? false,
      allIn: gamePlayer?.allIn ?? false,
      thinking:
        isCurrentTurn && !isMe && (isAI || nickname.startsWith('Bot-')),
      revealedCards,
      handName: showdownEntry?.handName ?? null,
      resultDelta: handResult ? handResult.delta : null,
      isWinner: handResult?.isWinner ?? false,
    })
  }
  return models
}
