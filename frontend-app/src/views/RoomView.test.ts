/**
 * RoomView.test.ts - Waiting-room view behavior: seat/ready/AI/leave buttons
 * emit the corresponding typed socket actions, and store-driven events
 * (game:started, room:settlement) drive navigation and the settlement panel.
 * The socket service and vue-router are mocked; Pinia stores and Vant run
 * for real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Vant from 'vant'
import type { OccupiedSeatInfo, RoomState, Settlement } from '@/types'
import RoomView from '@/views/RoomView.vue'
import SettlementDialog from '@/components/room/SettlementDialog.vue'
import { usePlayerStore } from '@/stores/player'
import { useRoomStore } from '@/stores/room'
import { useGameStore } from '@/stores/game'
import {
  addAI,
  borrowChips,
  joinRoom as socketJoinRoom,
  leaveRoom as socketLeaveRoom,
  ready as socketReady,
  removeAI,
  sit,
  stand,
} from '@/services/socket'

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  useRoute: () => ({ params: { id: 'ROOM1' } }),
}))

vi.mock('@/services/socket', () => ({
  connect: vi.fn(),
  isConnected: vi.fn(() => true),
  joinRoom: vi.fn(() => true),
  leaveRoom: vi.fn(() => true),
  sit: vi.fn(() => true),
  stand: vi.fn(() => true),
  ready: vi.fn(() => true),
  borrowChips: vi.fn(() => true),
  addAI: vi.fn(() => true),
  removeAI: vi.fn(() => true),
  startGame: vi.fn(() => true),
  setCurrentRoom: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}))

function occupiedSeat(position: number, overrides: Partial<OccupiedSeatInfo> = {}): OccupiedSeatInfo {
  return {
    position,
    status: 'occupied',
    playerId: `p${position}`,
    nickname: `玩家${position}`,
    avatar: '',
    isReady: false,
    chips: 1000,
    buyInTotal: 1000,
    borrowCount: 0,
    netResult: 0,
    isAI: false,
    ...overrides,
  }
}

/** Room with me seated at 0 (not ready), an AI at 1, and empty seats 2-5. */
function makeRoom(): RoomState {
  return {
    id: 'ROOM1',
    name: '测试房间',
    hostId: 'me',
    maxPlayers: 6,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: true,
    isPrivate: false,
    status: 'waiting',
    playerCount: 2,
    seatedCount: 2,
    createdAt: 1,
    dealerPosition: 0,
    awaitingNextHandReady: false,
    seats: [
      occupiedSeat(0, { playerId: 'me', nickname: 'Me' }),
      occupiedSeat(1, { playerId: 'ai-1', nickname: 'Bot', isAI: true, isReady: true }),
      { position: 2, status: 'empty' },
      { position: 3, status: 'empty' },
      { position: 4, status: 'empty' },
      { position: 5, status: 'empty' },
    ],
    players: [
      {
        playerId: 'me',
        nickname: 'Me',
        avatar: '',
        seatPosition: 0,
        isReady: false,
        chips: 1000,
        buyInTotal: 1000,
        borrowCount: 0,
        netResult: 0,
        isAI: false,
      },
      {
        playerId: 'ai-1',
        nickname: 'Bot',
        avatar: '',
        seatPosition: 1,
        isReady: true,
        chips: 1000,
        buyInTotal: 1000,
        borrowCount: 0,
        netResult: 0,
        isAI: true,
      },
    ],
  }
}

function mountRoom() {
  return mount(RoomView, { global: { plugins: [Vant] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  usePlayerStore().setIdentity({ id: 'me', nickname: 'Me', avatar: '', chips: 1000 })
  useRoomStore().applyRoomState(makeRoom())
})

describe('RoomView', () => {
  it('joins the room over the socket on mount and renders seats', () => {
    const wrapper = mountRoom()

    expect(socketJoinRoom).toHaveBeenCalledWith('ROOM1')
    expect(wrapper.text()).toContain('测试房间')
    expect(wrapper.text()).toContain('Me')
    expect(wrapper.text()).toContain('Bot')
    // 4 empty seats get sit buttons.
    expect(wrapper.find('[data-testid="btn-sit-2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="btn-sit-5"]').exists()).toBe(true)
  })

  it('emits seat:sit with the position when clicking 坐下', async () => {
    const wrapper = mountRoom()
    await wrapper.find('[data-testid="btn-sit-2"]').trigger('click')

    expect(sit).toHaveBeenCalledWith(2)
  })

  it('emits room:ready true when clicking 准备', async () => {
    const wrapper = mountRoom()
    await wrapper.find('[data-testid="btn-room-ready"]').trigger('click')

    expect(socketReady).toHaveBeenCalledWith(true)
  })

  it('emits room:ready false when clicking 取消准备', async () => {
    const roomStore = useRoomStore()
    roomStore.applyPlayerReady({ position: 0, ready: true })

    const wrapper = mountRoom()
    await wrapper.find('[data-testid="btn-room-ready"]').trigger('click')

    expect(socketReady).toHaveBeenCalledWith(false)
  })

  it('emits seat:stand when clicking 站起', async () => {
    const wrapper = mountRoom()
    await wrapper.find('[data-testid="btn-room-stand"]').trigger('click')

    expect(stand).toHaveBeenCalled()
  })

  it('shows host controls and emits room:add_ai / room:remove_ai', async () => {
    const wrapper = mountRoom()

    await wrapper.find('[data-testid="btn-room-add-ai"]').trigger('click')
    expect(addAI).toHaveBeenCalled()

    await wrapper.find('[data-testid="btn-remove-ai-1"]').trigger('click')
    expect(removeAI).toHaveBeenCalledWith(1)
  })

  it('keeps 开始游戏 disabled until everyone is ready', async () => {
    const wrapper = mountRoom()
    const startBtn = wrapper.find('[data-testid="btn-room-start"]')
    expect(startBtn.attributes('disabled')).toBeDefined()

    useRoomStore().applyPlayerReady({ position: 0, ready: true })
    await flushPromises()

    expect(wrapper.find('[data-testid="btn-room-start"]').attributes('disabled')).toBeUndefined()
  })

  it('emits room:leave when clicking 离开房间', async () => {
    const wrapper = mountRoom()
    await wrapper.find('[data-testid="btn-room-leave"]').trigger('click')

    expect(socketLeaveRoom).toHaveBeenCalled()
  })

  it('shows 借码 only when I am seated with 0 chips, and emits borrow', async () => {
    const roomStore = useRoomStore()
    const room = roomStore.room
    if (!room) throw new Error('room expected')
    const mySeat = room.seats[0]
    if (mySeat.status !== 'occupied') throw new Error('seat expected')
    mySeat.chips = 0

    const wrapper = mountRoom()
    await flushPromises()

    await wrapper.find('[data-testid="btn-room-borrow"]').trigger('click')
    expect(borrowChips).toHaveBeenCalled()
    // Ready is disabled while broke (legacy rule).
    expect(wrapper.find('[data-testid="btn-room-ready"]').attributes('disabled')).toBeDefined()
  })

  it('navigates to the table when game:started arrives', async () => {
    mountRoom()
    useGameStore().handleGameStarted({ gameId: 'ROOM1', dealer: 0, sb: 0, bb: 1 })
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith({ name: 'table', params: { id: 'ROOM1' } })
  })

  it('shows the settlement panel on room:settlement and returns to lobby on confirm', async () => {
    const wrapper = mountRoom()
    const settlement: Settlement = {
      playerId: 'me',
      nickname: 'Me',
      seatPosition: 0,
      chips: 1200,
      buyInTotal: 1000,
      borrowCount: 0,
      netResult: 200,
    }
    useRoomStore().applySettlement({ roomId: 'ROOM1', settlement })
    await flushPromises()

    const dialog = wrapper.findComponent(SettlementDialog)
    expect(dialog.props('show')).toBe(true)
    expect(dialog.props('title')).toBe('离房结算')
    expect(dialog.props('settlements')).toHaveLength(1)

    // Simulate the dialog confirm path.
    await dialog.vm.$emit('confirm')
    expect(pushMock).toHaveBeenCalledWith({ name: 'lobby' })
  })

  it('borrow settlement shows a toast path instead of the panel', async () => {
    const wrapper = mountRoom()
    useRoomStore().applySettlement({
      roomId: 'ROOM1',
      settlement: {
        playerId: 'me',
        nickname: 'Me',
        seatPosition: 0,
        chips: 1000,
        buyInTotal: 2000,
        borrowCount: 1,
        netResult: 0,
      },
      type: 'borrow',
    })
    await flushPromises()

    expect(wrapper.findComponent(SettlementDialog).props('show')).toBe(false)
    expect(useRoomStore().settlement).toBeNull()
  })
})
