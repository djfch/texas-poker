/**
 * useTableSounds.test.ts - Verifies the store->sound mapping: deal / chip /
 * fold / check / allin / turn / win fire on the matching transitions, only
 * the viewer's own turn beeps, and full-sync restores stay silent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { GamePlayer, GameState } from '@/types'
import { useTableSounds } from '@/audio/useTableSounds'
import { useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'
import { playSound } from '@/audio/sound'

vi.mock('@/audio/sound', () => ({
  playSound: vi.fn(),
}))

const Host = defineComponent({
  setup() {
    useTableSounds()
    return () => null
  },
})

function me(): GamePlayer {
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
    dealerPosition: 4,
    smallBlindPos: 3,
    bigBlindPos: 4,
    currentPosition: 4,
    currentPlayerId: 'bot',
    players: [me()],
    winners: null,
    handResults: null,
    showdownResults: null,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  usePlayerStore().setIdentity({ id: 'me', nickname: 'Me', avatar: '', chips: 1000 })
})

describe('deal / community sounds', () => {
  it('plays deal when hole cards arrive and when a street advances', async () => {
    mount(Host)
    const game = useGameStore()
    game.handleGameStarted({ gameId: 'g1', dealer: 4, sb: 3, bb: 4 })
    game.handleGameDealt({
      cards: [
        { suit: 'spades', rank: 'A' },
        { suit: 'hearts', rank: 'K' },
      ],
      position: 3,
    })
    await Promise.resolve()
    expect(vi.mocked(playSound)).toHaveBeenCalledWith('deal')

    vi.mocked(playSound).mockClear()
    game.handleGameCommunity({ cards: ['A♠', 'K♥', 'Q♦'], round: 'flop' })
    await Promise.resolve()
    expect(vi.mocked(playSound)).toHaveBeenCalledWith('deal')
  })

  it('stays silent on a full-sync restore', async () => {
    mount(Host)
    useGameStore().handleGameState(
      makeGameState({ status: 'flop', communityCards: ['A♠', 'K♥', 'Q♦'] }),
    )
    await Promise.resolve()
    expect(vi.mocked(playSound)).not.toHaveBeenCalled()
  })
})

describe('action sounds', () => {
  it.each([
    ['call', 'chip'],
    ['bet', 'chip'],
    ['raise', 'chip'],
    ['fold', 'fold'],
    ['check', 'check'],
    ['allin', 'allin'],
  ] as const)('maps %s to %s', async (action, sound) => {
    mount(Host)
    useGameStore().handleGameAction({ position: 1, type: action, amount: 100 })
    await Promise.resolve()
    expect(vi.mocked(playSound)).toHaveBeenCalledWith(sound)
  })
})

describe('turn sound', () => {
  it('beeps only when the turn is my own seat', async () => {
    mount(Host)
    const game = useGameStore()
    game.handleGameDealt({ cards: [], position: 3 })

    game.handleGameTurn({ position: 4, timeoutAt: Date.now() + 30000, currentBet: 20, minRaise: 20, totalPot: 30 })
    await Promise.resolve()
    expect(vi.mocked(playSound)).not.toHaveBeenCalledWith('turn')

    game.handleGameTurn({ position: 3, timeoutAt: Date.now() + 30000, currentBet: 20, minRaise: 20, totalPot: 30 })
    await Promise.resolve()
    expect(vi.mocked(playSound)).toHaveBeenCalledWith('turn')
  })
})

describe('win sound', () => {
  it('plays win when I am among the winners', async () => {
    mount(Host)
    const game = useGameStore()
    game.handleGameStarted({ gameId: 'g1', dealer: 4, sb: 3, bb: 4 })
    game.handleGameDealt({ cards: [], position: 3 })
    // Let the status settle to preflop first: game:ended is a separate socket
    // event in production, so the watcher observes preflop -> ended (not the
    // skipped null -> ended fresh/restore transition).
    await Promise.resolve()
    game.handleGameEnded({
      winners: [{ playerId: 'me', position: 3, nickname: 'Me', amount: 60, payout: 60, hand: 'Pair' }],
      handResults: [],
      nextHandDelay: 0,
    })
    await Promise.resolve()
    expect(vi.mocked(playSound)).toHaveBeenCalledWith('win')
  })

  it('does not play win when I did not win', async () => {
    mount(Host)
    const game = useGameStore()
    game.handleGameStarted({ gameId: 'g1', dealer: 4, sb: 3, bb: 4 })
    game.handleGameDealt({ cards: [], position: 3 })
    await Promise.resolve()
    game.handleGameEnded({
      winners: [{ playerId: 'bot', position: 5, nickname: 'Bot', amount: 60, payout: 60, hand: 'Pair' }],
      handResults: [],
      nextHandDelay: 0,
    })
    await Promise.resolve()
    expect(vi.mocked(playSound)).not.toHaveBeenCalledWith('win')
  })
})
