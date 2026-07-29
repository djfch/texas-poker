/**
 * ActionBar.test.ts - Betting action bar: renders the game store's
 * validActions in legacy order (fold/check/call/bet/raise/allin), carries
 * amounts on call/all-in labels, emits clamped raise amounts from the
 * slider, and stays hidden outside the viewer's own turn. The Pinia game
 * store runs for real; Vant is installed for the slider.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Vant from 'vant'
import type { GamePlayer, ValidAction } from '@/types'
import ActionBar from '@/components/table/ActionBar.vue'
import { useGameStore } from '@/stores/game'
import { usePlayerStore } from '@/stores/player'

function makePlayer(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    playerId: 'me',
    nickname: 'Me',
    avatar: '',
    seatPosition: 0,
    chips: 1000,
    startingChips: 1000,
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    holeCards: null,
    ...overrides,
  }
}

function setupTurn(validActions: ValidAction[], myTurn = true): void {
  const game = useGameStore()
  game.mySeatPosition = 0
  game.currentPosition = myTurn ? 0 : 1
  game.currentBet = 50
  game.minRaise = 100
  game.totalPot = 200
  game.validActions = validActions
  game.players = [makePlayer(), makePlayer({ playerId: 'op', seatPosition: 1 })]
}

function mountBar() {
  return mount(ActionBar, { global: { plugins: [Vant] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  usePlayerStore().setIdentity({ id: 'me', nickname: 'Me', avatar: '', chips: 1000 })
})

describe('valid action rendering', () => {
  it('renders fold/check/call in legacy order with the call amount', () => {
    setupTurn([{ type: 'call', amount: 50 }, { type: 'fold' }, { type: 'check' }])
    const wrapper = mountBar()

    const buttons = wrapper.findAll('.action-btn')
    expect(buttons.map(b => b.text())).toEqual(['弃牌', '过牌', '跟注 ¥50'])
    expect(wrapper.find('[data-testid="action-bar"]').exists()).toBe(true)
  })

  it('emits call with the server-provided amount', async () => {
    setupTurn([{ type: 'fold' }, { type: 'call', amount: 50 }])
    const wrapper = mountBar()

    await wrapper.find('[data-testid="action-call"]').trigger('click')
    expect(wrapper.emitted('action')).toEqual([['call', 50]])
  })

  it('shows the all-in label with my chips and emits without an amount', async () => {
    setupTurn([{ type: 'allin' }])
    const wrapper = mountBar()

    expect(wrapper.find('[data-testid="action-allin"]').text()).toBe('全押 ¥1,000')
    await wrapper.find('[data-testid="action-allin"]').trigger('click')
    expect(wrapper.emitted('action')).toEqual([['allin']])
  })

  it('renders the raise slider and emits the clamped raise amount', async () => {
    setupTurn([{ type: 'fold' }, { type: 'raise', minAmount: 100, maxAmount: 1000 }])
    const wrapper = mountBar()

    expect(wrapper.find('[data-testid="raise-slider"]').exists()).toBe(true)
    // Default raise amount is the minimum raise.
    await wrapper.find('[data-testid="action-raise"]').trigger('click')
    expect(wrapper.emitted('action')).toEqual([['raise', 100]])
  })

  it('emits the slider value after a quick-button change', async () => {
    setupTurn([{ type: 'raise', minAmount: 100, maxAmount: 1000 }])
    const wrapper = mountBar()

    // 满池 quick button sets the amount to the pot (200).
    const quickButtons = wrapper.findAll('.quick-btn')
    await quickButtons[2]!.trigger('click')
    await wrapper.find('[data-testid="action-raise"]').trigger('click')
    expect(wrapper.emitted('action')).toEqual([['raise', 200]])
  })
})

describe('visibility rules', () => {
  it('renders nothing outside the viewer turn', () => {
    setupTurn([{ type: 'fold' }, { type: 'check' }], false)
    const wrapper = mountBar()
    expect(wrapper.find('[data-testid="action-bar"]').exists()).toBe(false)
  })

  it('renders nothing when validActions is empty', () => {
    setupTurn([])
    const wrapper = mountBar()
    expect(wrapper.find('[data-testid="action-bar"]').exists()).toBe(false)
  })

  it('hides itself right after an action is emitted', async () => {
    setupTurn([{ type: 'fold' }, { type: 'check' }])
    const wrapper = mountBar()

    await wrapper.find('[data-testid="action-fold"]').trigger('click')
    expect(wrapper.emitted('action')).toEqual([['fold']])
    expect(wrapper.find('[data-testid="action-bar"]').exists()).toBe(false)
  })
})
