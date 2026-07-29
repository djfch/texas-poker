/**
 * App.test.ts - Global mid-hand recovery watcher: a room:state reporting a
 * playing room we belong to navigates back to its table route; guards cover
 * the waiting status, non-members and already-on-table cases. vue-router is
 * mocked; Pinia stores run for real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { RoomState, SeatInfo } from '@/types'
import App from '@/App.vue'
import { usePlayerStore } from '@/stores/player'
import { useRoomStore } from '@/stores/room'

const { pushMock, currentRoute } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  currentRoute: { name: 'lobby' as string, params: {} as Record<string, string> },
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  useRoute: () => currentRoute,
}))

function makeRoom(overrides: Partial<RoomState> = {}): RoomState {
  const seats: SeatInfo[] = [
    {
      position: 0,
      status: 'occupied',
      playerId: 'me',
      nickname: 'Me',
      avatar: '',
      isReady: true,
      chips: 1000,
      buyInTotal: 1000,
      borrowCount: 0,
      netResult: 0,
      isAI: false,
    },
  ]
  for (let position = 1; position < 9; position += 1) {
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
    status: 'playing',
    playerCount: 1,
    seatedCount: 1,
    createdAt: 1700000000000,
    dealerPosition: 0,
    awaitingNextHandReady: false,
    seats,
    players: [
      {
        playerId: 'me',
        nickname: 'Me',
        avatar: '',
        seatPosition: 0,
        isReady: true,
        chips: 1000,
        buyInTotal: 1000,
        borrowCount: 0,
        netResult: 0,
        isAI: false,
      },
    ],
    ...overrides,
  }
}

let wrapper: VueWrapper | null = null

function mountApp(): void {
  wrapper = mount(App, { global: { stubs: { 'router-view': true } } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  pushMock.mockClear()
  currentRoute.name = 'lobby'
  currentRoute.params = {}
  usePlayerStore().setIdentity({ id: 'me', nickname: 'Me', avatar: '', chips: 1000 })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('mid-hand recovery watcher', () => {
  it('navigates to the table when a playing room snapshot finds me seated', async () => {
    mountApp()
    useRoomStore().applyRoomState(makeRoom())
    await nextTick()

    expect(pushMock).toHaveBeenCalledWith({ name: 'table', params: { id: 'room1' } })
  })

  it('ignores rooms that are not playing', async () => {
    mountApp()
    useRoomStore().applyRoomState(makeRoom({ status: 'waiting' }))
    await nextTick()

    expect(pushMock).not.toHaveBeenCalled()
  })

  it('ignores playing rooms I do not belong to', async () => {
    mountApp()
    useRoomStore().applyRoomState(
      makeRoom({
        seats: [{ position: 0, status: 'empty' }],
        players: [],
      }),
    )
    await nextTick()

    expect(pushMock).not.toHaveBeenCalled()
  })

  it('does not re-navigate while already on that table route', async () => {
    currentRoute.name = 'table'
    currentRoute.params = { id: 'room1' }
    mountApp()
    useRoomStore().applyRoomState(makeRoom())
    await nextTick()

    expect(pushMock).not.toHaveBeenCalled()
  })
})
