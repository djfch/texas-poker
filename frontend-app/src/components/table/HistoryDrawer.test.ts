/**
 * HistoryDrawer.test.ts - The records drawer renders the client-accumulated
 * handHistory (most-recent-first) with showdown + settlement rows, and shows
 * the empty state when no hand has finished yet. van-popup is stubbed so its
 * teleported slot renders inline for querying.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import HistoryDrawer from '@/components/table/HistoryDrawer.vue'
import { useGameStore, type HandHistoryRecord } from '@/stores/game'

let pinia: Pinia

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

const popupStub = { template: '<div class="popup-stub"><slot /></div>' }

function mountDrawer() {
  return mount(HistoryDrawer, {
    props: { show: true },
    global: { plugins: [pinia], stubs: { 'van-popup': popupStub } },
  })
}

function makeRecord(overrides: Partial<HandHistoryRecord> = {}): HandHistoryRecord {
  return {
    gameId: 'g1',
    endedAt: Date.UTC(2026, 0, 1, 12, 0, 0),
    showdown: [
      { playerId: 'me', position: 3, nickname: 'Me', cards: ['A♠', 'K♥'], handName: '高牌', isWinner: true },
    ],
    results: [
      { playerId: 'me', position: 3, nickname: 'Me', chips: 1110, startingChips: 1000, delta: 110, isWinner: true },
    ],
    winners: [{ playerId: 'me', position: 3, nickname: 'Me', amount: 130, payout: 130, hand: '高牌' }],
    ...overrides,
  }
}

describe('HistoryDrawer', () => {
  it('shows the empty state when no hand has finished', () => {
    const wrapper = mountDrawer()

    expect(wrapper.find('.history-empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('暂无牌局记录')
    expect(wrapper.find('.history-hand').exists()).toBe(false)
  })

  it('renders accumulated hands with showdown and settlement rows', () => {
    const game = useGameStore()
    game.handHistory = [makeRecord({ gameId: 'g2' }), makeRecord({ gameId: 'g1' })]

    const wrapper = mountDrawer()
    const hands = wrapper.findAll('.history-hand')

    expect(hands).toHaveLength(2)
    expect(wrapper.find('.history-empty').exists()).toBe(false)
    // Showdown block reveals cards + hand name.
    expect(wrapper.text()).toContain('摊牌')
    expect(wrapper.text()).toContain('高牌')
    // Settlement block shows a signed delta.
    expect(wrapper.text()).toContain('结算')
    expect(wrapper.text()).toContain('+¥110')
    // Most-recent-first recency labels.
    expect(hands[0]!.text()).toContain('#1')
    expect(hands[1]!.text()).toContain('#2')
  })

  it('renders a settlement-only hand (fold win with no showdown)', () => {
    const game = useGameStore()
    game.handHistory = [makeRecord({ showdown: [] })]

    const wrapper = mountDrawer()

    expect(wrapper.findAll('.history-hand')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('摊牌')
    expect(wrapper.text()).toContain('结算')
  })
})
