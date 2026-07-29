/**
 * RoomActions.test.ts - In-flight debounce: a click disables the buttons
 * until the next room:state snapshot lands, and the matching event is
 * emitted exactly once.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import Vant from 'vant'
import type { RoomState, SeatInfo } from '@/types'
import RoomActions from '@/components/room/RoomActions.vue'
import { useRoomStore } from '@/stores/room'

const DEFAULT_PROPS = {
  seated: true,
  isReady: false,
  canBorrow: false,
  borrowTitle: '',
  showAddAI: false,
  canAddAI: false,
  addAITitle: '',
  showStart: true,
  canStart: true,
  startTitle: '',
}

function makeRoom(): RoomState {
  const seats: SeatInfo[] = []
  for (let position = 0; position < 9; position += 1) {
    seats.push({ position, status: 'empty' })
  }
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
    status: 'waiting',
    playerCount: 1,
    seatedCount: 1,
    createdAt: 1700000000000,
    dealerPosition: 0,
    awaitingNextHandReady: false,
    seats,
    players: [],
  }
}

function mountActions() {
  return mount(RoomActions, { props: DEFAULT_PROPS, global: { plugins: [Vant] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('in-flight debounce', () => {
  it('start click disables the button until the next room:state arrives', async () => {
    const wrapper = mountActions()
    const start = wrapper.find('[data-testid="btn-room-start"]')

    expect(start.attributes('disabled')).toBeUndefined()
    await start.trigger('click')

    expect(wrapper.emitted('start')).toHaveLength(1)
    expect(start.attributes('disabled')).toBeDefined()

    // Further clicks are swallowed while in flight.
    await start.trigger('click')
    expect(wrapper.emitted('start')).toHaveLength(1)

    // The authoritative room:state re-arms the buttons.
    useRoomStore().applyRoomState(makeRoom())
    await nextTick()
    expect(start.attributes('disabled')).toBeUndefined()
  })

  it('leave click also debounces', async () => {
    const wrapper = mountActions()
    const leave = wrapper.find('[data-testid="btn-room-leave"]')

    await leave.trigger('click')
    await leave.trigger('click')

    expect(wrapper.emitted('leave')).toHaveLength(1)
    expect(leave.attributes('disabled')).toBeDefined()
  })
})
