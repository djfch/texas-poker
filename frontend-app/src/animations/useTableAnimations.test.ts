/**
 * useTableAnimations.test.ts - Watcher guards: a game:state full-sync
 * restore (status rising from null) must render hole cards / community
 * cards without firing deal/reveal animations, while the live
 * started -> dealt -> community sequence still animates.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { GamePlayer, GameState } from '@/types'
import { useTableAnimations } from '@/animations/useTableAnimations'
import { dealHoleCards, revealCommunity } from '@/animations/index'
import { useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'

vi.mock('@/animations/index', async importOriginal => {
  const actual = await importOriginal<typeof import('@/animations/index')>()
  return {
    ...actual,
    dealHoleCards: vi.fn(actual.dealHoleCards),
    revealCommunity: vi.fn(actual.revealCommunity),
  }
})

const TABLE_TEMPLATE = `
  <div ref="surface">
    <div data-deck></div>
    <div data-pot><div class="pot-main"><span class="pot-value">¥0</span></div></div>
    <div data-community>
      <div data-community-index="0"><div class="poker-card"></div></div>
      <div data-community-index="1"><div class="poker-card"></div></div>
      <div data-community-index="2"><div class="poker-card"></div></div>
      <div data-community-index="3"><div class="poker-card"></div></div>
      <div data-community-index="4"><div class="poker-card"></div></div>
    </div>
    <div class="table-seat" data-seat-index="3">
      <div class="seat-ring"></div>
      <div class="seat-inner">
        <div class="seat-cards"><div class="poker-card"></div><div class="poker-card"></div></div>
      </div>
      <div class="seat-bet" data-seat-bet></div>
    </div>
    <div class="table-seat" data-seat-index="4">
      <div class="seat-ring"></div>
      <div class="seat-inner"></div>
    </div>
  </div>
`

const TestSurface = defineComponent({
  setup() {
    const surface = ref<HTMLElement | null>(null)
    useTableAnimations(surface)
    return { surface }
  },
  template: TABLE_TEMPLATE,
})

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  const me: GamePlayer = {
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
    players: [me],
    winners: null,
    handResults: null,
    showdownResults: null,
    ...overrides,
  }
}

/** Flush the watcher queue plus the nextTick inside each watcher body. */
async function settle(): Promise<void> {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  usePlayerStore().setIdentity({ id: 'me', nickname: 'Me', avatar: '', chips: 1000 })
})

describe('full-sync restore guards', () => {
  it('restoring 0->3 community and 0->2 hole cards fires no animations', async () => {
    mount(TestSurface)
    useGameStore().handleGameState(
      makeGameState({
        status: 'flop',
        communityCards: ['A♠', 'K♥', 'Q♦'],
        players: [
          {
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
            holeCards: ['A♠', 'K♥'],
          },
        ],
      }),
    )
    await settle()

    expect(vi.mocked(dealHoleCards)).not.toHaveBeenCalled()
    expect(vi.mocked(revealCommunity)).not.toHaveBeenCalled()
  })

  it('the live started -> dealt -> community sequence still animates', async () => {
    mount(TestSurface)
    const game = useGameStore()

    game.handleGameStarted({ gameId: 'g1', dealer: 4, sb: 3, bb: 4 })
    game.handleGameDealt({
      cards: [
        { suit: 'spades', rank: 'A' },
        { suit: 'hearts', rank: 'K' },
      ],
      position: 3,
    })
    await settle()
    expect(vi.mocked(dealHoleCards)).toHaveBeenCalledTimes(1)

    game.handleGameCommunity({ cards: ['A♠', 'K♥', 'Q♦'], round: 'flop' })
    await settle()
    expect(vi.mocked(revealCommunity)).toHaveBeenCalledTimes(1)
  })

  it('a live street transition after a full-sync restore still animates', async () => {
    mount(TestSurface)
    const game = useGameStore()

    // Restore into the flop: no reveal animation for the restored cards.
    game.handleGameState(
      makeGameState({ status: 'flop', communityCards: ['A♠', 'K♥', 'Q♦'] }),
    )
    await settle()
    expect(vi.mocked(revealCommunity)).not.toHaveBeenCalled()

    // The next live street is not part of the restore and must animate.
    game.handleGameCommunity({ cards: ['A♠', 'K♥', 'Q♦', 'J♣'], round: 'turn' })
    await settle()
    expect(vi.mocked(revealCommunity)).toHaveBeenCalledTimes(1)
  })
})
