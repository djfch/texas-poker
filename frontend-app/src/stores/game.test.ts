/**
 * game.test.ts - Core state transitions of the game store: the full
 * started -> dealt -> community -> turn -> action -> pot -> showdown ->
 * ended sequence plus game:state full recovery.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { GamePlayer, GameState, RoomState } from '@/types'
import { MAX_HAND_HISTORY, useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'
import { useRoomStore } from '@/stores/room'

function makeGamePlayer(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    playerId: 'me',
    nickname: 'Me',
    avatar: '',
    seatPosition: 3,
    chips: 980,
    startingChips: 1000,
    bet: 20,
    totalBet: 20,
    folded: false,
    allIn: false,
    holeCards: null,
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    status: 'preflop',
    communityCards: [],
    pots: { mainPot: 30, sidePots: [] },
    totalPot: 30,
    currentBet: 20,
    minRaise: 20,
    dealerPosition: 0,
    smallBlindPos: 1,
    bigBlindPos: 2,
    currentPosition: 3,
    currentPlayerId: 'me',
    players: [
      makeGamePlayer(),
      makeGamePlayer({ playerId: 'bot', seatPosition: 4, holeCards: null }),
    ],
    winners: null,
    handResults: null,
    showdownResults: null,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  usePlayerStore().setIdentity({ id: 'me', nickname: 'Me', avatar: '', chips: 1000 })
})

describe('hand sequence: started/dealt/turn', () => {
  it('game:started resets per-hand data and sets blind positions', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    game.handleGameStarted({ gameId: 'room1', dealer: 4, sb: 5, bb: 6 })

    expect(game.status).toBe('preflop')
    expect(game.dealerPosition).toBe(4)
    expect(game.smallBlindPos).toBe(5)
    expect(game.bigBlindPos).toBe(6)
    expect(game.communityCards).toEqual([])
    expect(game.myHoleCards).toEqual([])
    expect(game.showdownResults).toEqual([])
    expect(game.winners).toBeNull()
    // Players keep their identity but betting flags reset for the new hand.
    expect(game.players).toHaveLength(2)
    expect(game.players[0]?.bet).toBe(0)
    expect(game.players[0]?.folded).toBe(false)
  })

  it('game:dealt stores my hole cards and seat position', () => {
    const game = useGameStore()
    game.handleGameDealt({
      cards: [
        { suit: 'spades', rank: 'A' },
        { suit: 'hearts', rank: 'K' },
      ],
      position: 3,
    })

    expect(game.mySeatPosition).toBe(3)
    expect(game.myHoleCards).toEqual([
      { suit: 'spades', rank: 'A' },
      { suit: 'hearts', rank: 'K' },
    ])
  })

  it('private turn sets validActions; public duplicate keeps them', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())

    const privateTurn = {
      position: 3,
      timeoutAt: 1700000000000,
      validActions: [
        { type: 'call', amount: 20 },
        { type: 'raise', minAmount: 40, maxAmount: 980 },
        { type: 'fold' },
      ] as const,
      currentBet: 20,
      minRaise: 20,
      totalPot: 30,
    }
    game.handleGameTurn({ ...privateTurn, validActions: [...privateTurn.validActions] })
    expect(game.isMyTurn).toBe(true)
    expect(game.validActions).toHaveLength(3)
    expect(game.turnTimeoutAt).toBe(1700000000000)

    // The broadcast copy (no validActions) must not wipe the private ones.
    game.handleGameTurn({ position: 3, timeoutAt: 1700000000000, currentBet: 20, minRaise: 20, totalPot: 30 })
    expect(game.validActions).toHaveLength(3)
  })

  it('turn of another seat clears my validActions', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    game.handleGameTurn({
      position: 3,
      timeoutAt: 1,
      validActions: [{ type: 'check' }],
      currentBet: 0,
      minRaise: 20,
      totalPot: 30,
    })
    expect(game.validActions).toHaveLength(1)

    game.handleGameTurn({ position: 4, timeoutAt: 2, currentBet: 0, minRaise: 20, totalPot: 30 })
    expect(game.validActions).toEqual([])
    expect(game.isMyTurn).toBe(false)
    expect(game.currentPosition).toBe(4)
  })
})

describe('hand sequence: community/action/pot/showdown/ended', () => {
  it('game:community replaces the card list and street', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    game.handleGameCommunity({ cards: ['A♠', 'K♥', 'Q♦'], round: 'flop' })

    expect(game.communityCards).toEqual(['A♠', 'K♥', 'Q♦'])
    expect(game.status).toBe('flop')
  })

  it('game:action records lastAction and flags fold/all-in on the seat', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    game.handleGameAction({ position: 4, type: 'fold', amount: 0 })

    expect(game.lastAction).toEqual({ position: 4, type: 'fold', amount: 0 })
    expect(game.players.find(p => p.seatPosition === 4)?.folded).toBe(true)
  })

  it('game:pot updates pots and merges per-player chip snapshots', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    game.handleGamePot({
      mainPot: 90,
      sidePots: [{ amount: 40, eligiblePositions: [3] }],
      totalPot: 130,
      players: [
        { playerId: 'me', position: 3, chips: 900, bet: 100, totalBet: 100, allIn: false },
        { playerId: 'bot', position: 4, chips: 0, bet: 30, totalBet: 30, allIn: true },
      ],
    })

    expect(game.pots.mainPot).toBe(90)
    expect(game.pots.sidePots).toEqual([{ amount: 40, eligiblePositions: [3] }])
    expect(game.totalPot).toBe(130)
    expect(game.players.find(p => p.playerId === 'me')?.chips).toBe(900)
    expect(game.players.find(p => p.playerId === 'bot')?.allIn).toBe(true)
  })

  it('showdown then ended produce the final settlement state', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())

    game.handleGameShowdown({
      results: [
        {
          playerId: 'me',
          position: 3,
          nickname: 'Me',
          cards: ['A♠', 'K♥'],
          handName: '高牌',
          isWinner: true,
        },
      ],
    })
    expect(game.status).toBe('showdown')
    expect(game.showdownResults).toHaveLength(1)

    game.handleGameEnded({
      winners: [
        { playerId: 'me', position: 3, nickname: 'Me', amount: 130, payout: 130, hand: '高牌' },
      ],
      handResults: [
        {
          playerId: 'me',
          position: 3,
          nickname: 'Me',
          chips: 1110,
          startingChips: 1000,
          delta: 110,
          isWinner: true,
        },
      ],
      nextHandDelay: 5000,
    })

    expect(game.status).toBe('ended')
    expect(game.winners?.[0]?.amount).toBe(130)
    expect(game.handResults?.[0]?.delta).toBe(110)
    expect(game.nextHandDelay).toBe(5000)
    expect(game.currentPosition).toBeNull()
    expect(game.validActions).toEqual([])
  })
})

describe('handHistory accumulation (records drawer)', () => {
  function endHand(game: ReturnType<typeof useGameStore>, gameId: string): void {
    game.handleGameShowdown({
      results: [
        {
          playerId: 'me',
          position: 3,
          nickname: 'Me',
          cards: ['A♠', 'K♥'],
          handName: '高牌',
          isWinner: true,
        },
      ],
    })
    game.handleGameEnded({
      winners: [
        { playerId: 'me', position: 3, nickname: 'Me', amount: 130, payout: 130, hand: '高牌' },
      ],
      handResults: [
        {
          playerId: 'me',
          position: 3,
          nickname: 'Me',
          chips: 1110,
          startingChips: 1000,
          delta: 110,
          isWinner: true,
        },
      ],
      nextHandDelay: 5000,
    })
    // Emulate the next hand starting, which clears the live fields.
    game.gameId = gameId
  }

  it('game:ended appends a snapshot with showdown, results and winners', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    endHand(game, 'room1')

    expect(game.handHistory).toHaveLength(1)
    expect(game.handHistory[0].showdown).toHaveLength(1)
    expect(game.handHistory[0].results[0].delta).toBe(110)
    expect(game.handHistory[0].winners[0].amount).toBe(130)
    expect(typeof game.handHistory[0].endedAt).toBe('number')
  })

  it('history survives the next hand start (which clears live fields)', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    endHand(game, 'room1')

    game.handleGameStarted({ gameId: 'room1', dealer: 4, sb: 5, bb: 6 })

    expect(game.showdownResults).toEqual([])
    expect(game.handResults).toBeNull()
    expect(game.handHistory).toHaveLength(1)
  })

  it('keeps most-recent-first order and caps at MAX_HAND_HISTORY', () => {
    const game = useGameStore()
    for (let i = 0; i < MAX_HAND_HISTORY + 5; i += 1) {
      game.handleGameState(makeGameState())
      game.handleGameShowdown({ results: [] })
      game.handleGameEnded({
        winners: [],
        handResults: [
          {
            playerId: 'me',
            position: 3,
            nickname: 'Me',
            chips: 1000 + i,
            startingChips: 1000,
            delta: i,
            isWinner: false,
          },
        ],
        nextHandDelay: 0,
      })
    }

    expect(game.handHistory).toHaveLength(MAX_HAND_HISTORY)
    // Newest first: the last-ended hand (delta = MAX + 4) leads the list.
    expect(game.handHistory[0].results[0].delta).toBe(MAX_HAND_HISTORY + 4)
  })

  it('resetGame clears the accumulated history', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    endHand(game, 'room1')
    expect(game.handHistory).toHaveLength(1)

    game.resetGame()
    expect(game.handHistory).toEqual([])
  })
})

describe('game:state full recovery', () => {
  it('restores the complete snapshot and re-derives my seat and hole cards', () => {
    const game = useGameStore()
    game.handleGameState(
      makeGameState({
        status: 'turn',
        communityCards: ['A♠', 'K♥', 'Q♦', 'J♣'],
        players: [makeGamePlayer({ holeCards: ['A♠', 'K♥'] })],
      }),
    )

    expect(game.status).toBe('turn')
    expect(game.communityCards).toHaveLength(4)
    expect(game.totalPot).toBe(30)
    expect(game.mySeatPosition).toBe(3)
    // Wire strings are parsed back into structured cards.
    expect(game.myHoleCards).toEqual([
      { suit: 'spades', rank: 'A' },
      { suit: 'hearts', rank: 'K' },
    ])
  })

  it('bumps restoreSeq on every full sync so watchers can spot restores', () => {
    const game = useGameStore()
    const before = game.restoreSeq

    game.handleGameState(makeGameState())
    expect(game.restoreSeq).toBe(before + 1)
    game.handleGameState(makeGameState())
    expect(game.restoreSeq).toBe(before + 2)
  })

  it('resetGame clears everything', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    game.resetGame()

    expect(game.status).toBeNull()
    expect(game.players).toEqual([])
    expect(game.mySeatPosition).toBeNull()
    expect(game.totalPot).toBe(0)
  })
})

/** Playing room with me (seat 3) and a bot (seat 4) occupied. */
function makePlayingRoom(): RoomState {
  const seats: RoomState['seats'] = []
  for (let position = 0; position < 9; position += 1) {
    seats.push({ position, status: 'empty' })
  }
  const occupy = (position: number, playerId: string, nickname: string, chips: number) => {
    seats[position] = {
      position,
      status: 'occupied',
      playerId,
      nickname,
      avatar: '',
      isReady: true,
      chips,
      buyInTotal: 1000,
      borrowCount: 0,
      netResult: 0,
      isAI: false,
    }
  }
  occupy(3, 'me', 'Me', 1000)
  occupy(4, 'bot', 'Bot', 800)
  return {
    id: 'room1',
    name: 'Test Room',
    hostId: 'me',
    maxPlayers: 6,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: false,
    isPrivate: false,
    status: 'playing',
    playerCount: 2,
    seatedCount: 2,
    createdAt: 1700000000000,
    dealerPosition: 3,
    awaitingNextHandReady: false,
    seats,
    players: [],
  }
}

describe('normal start without game:state (roster synthesis)', () => {
  it('started/dealt/turn/pot fills players and merges chip/bet snapshots', () => {
    useRoomStore().applyRoomState(makePlayingRoom())
    const game = useGameStore()

    game.handleGameStarted({ gameId: 'room1', dealer: 3, sb: 4, bb: 3 })
    expect(game.players).toHaveLength(2)
    expect(game.players.find(p => p.playerId === 'me')).toMatchObject({
      nickname: 'Me',
      seatPosition: 3,
      chips: 1000,
      bet: 0,
      folded: false,
      allIn: false,
    })
    expect(game.players.find(p => p.playerId === 'bot')?.chips).toBe(800)

    game.handleGameDealt({
      cards: [
        { suit: 'spades', rank: 'A' },
        { suit: 'hearts', rank: 'K' },
      ],
      position: 3,
    })
    game.handleGameTurn({
      position: 3,
      timeoutAt: 1,
      validActions: [{ type: 'check' }],
      currentBet: 0,
      minRaise: 20,
      totalPot: 30,
    })
    expect(game.isMyTurn).toBe(true)

    game.handleGamePot({
      mainPot: 30,
      sidePots: [],
      totalPot: 30,
      players: [
        { playerId: 'me', position: 3, chips: 980, bet: 20, totalBet: 20, allIn: false },
        { playerId: 'bot', position: 4, chips: 790, bet: 10, totalBet: 10, allIn: false },
      ],
    })
    expect(game.players.find(p => p.playerId === 'me')?.chips).toBe(980)
    expect(game.players.find(p => p.playerId === 'me')?.bet).toBe(20)
    expect(game.players.find(p => p.playerId === 'bot')?.chips).toBe(790)
  })

  it('game:started clears my seat until game:dealt re-binds it', () => {
    const game = useGameStore()
    game.handleGameDealt({
      cards: [
        { suit: 'spades', rank: 'A' },
        { suit: 'hearts', rank: 'K' },
      ],
      position: 3,
    })
    expect(game.mySeatPosition).toBe(3)

    game.handleGameStarted({ gameId: 'room1', dealer: 3, sb: 4, bb: 3 })
    expect(game.mySeatPosition).toBeNull()
  })

  it('falls back to flag reset when no room snapshot is available', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    game.handleGameStarted({ gameId: 'room1', dealer: 4, sb: 5, bb: 6 })

    expect(game.players).toHaveLength(2)
    expect(game.players[0]?.bet).toBe(0)
    expect(game.players[0]?.folded).toBe(false)
  })
})

describe('game:state keeps private turn data', () => {
  it('keeps validActions while the snapshot still shows my turn', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    game.handleGameTurn({
      position: 3,
      timeoutAt: 1,
      validActions: [{ type: 'check' }],
      currentBet: 0,
      minRaise: 20,
      totalPot: 30,
    })
    expect(game.validActions).toHaveLength(1)

    // Re-sync with the turn unchanged: the private actions must survive.
    game.handleGameState(makeGameState())
    expect(game.validActions).toHaveLength(1)
  })

  it('clears validActions when the snapshot shows the turn moved on', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    game.handleGameTurn({
      position: 3,
      timeoutAt: 1,
      validActions: [{ type: 'check' }],
      currentBet: 0,
      minRaise: 20,
      totalPot: 30,
    })

    game.handleGameState(makeGameState({ currentPosition: 4, currentPlayerId: 'bot' }))
    expect(game.validActions).toEqual([])
  })

  it('a null hole-card view keeps dealt cards mid-hand, clears after the hand', () => {
    const game = useGameStore()
    game.handleGameState(makeGameState())
    game.handleGameDealt({
      cards: [
        { suit: 'spades', rank: 'A' },
        { suit: 'hearts', rank: 'K' },
      ],
      position: 3,
    })

    // Mid-hand full sync carries a null viewer view: cards must survive.
    game.handleGameState(makeGameState({ status: 'flop', communityCards: ['A♠', 'K♥', 'Q♦'] }))
    expect(game.myHoleCards).toEqual([
      { suit: 'spades', rank: 'A' },
      { suit: 'hearts', rank: 'K' },
    ])

    // Once the hand is over the same null view clears them.
    game.handleGameState(makeGameState({ status: 'ended' }))
    expect(game.myHoleCards).toEqual([])
  })
})
