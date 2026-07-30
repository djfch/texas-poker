/**
 * useNextHandAction.test.ts - The shared between-hands button state:
 * hidden unless the room awaits next-hand readiness and I am seated; then
 * 借筹码 when broke, 准备 when funded/not-ready, 已准备 (disabled) once ready.
 * This is the logic that also powers the persistent footer button so the
 * "收起 then stuck" deadlock cannot recur.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { OccupiedSeatInfo, RoomState } from '@/types'
import { usePlayerStore } from '@/stores/player'
import { useRoomStore } from '@/stores/room'
import { useNextHandAction } from '@/composables/useNextHandAction'

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

function makeRoom(overrides: Partial<RoomState> = {}): RoomState {
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
    playerCount: 1,
    seatedCount: 1,
    createdAt: 1,
    dealerPosition: 0,
    awaitingNextHandReady: true,
    seats: [
      occupiedSeat(0, { playerId: 'me', nickname: 'Me' }),
      { position: 1, status: 'empty' },
      { position: 2, status: 'empty' },
      { position: 3, status: 'empty' },
      { position: 4, status: 'empty' },
      { position: 5, status: 'empty' },
    ],
    players: [],
    ...overrides,
  }
}

function setRoom(overrides: Partial<RoomState> = {}, seatOverrides: Partial<OccupiedSeatInfo> = {}): void {
  const room = makeRoom(overrides)
  room.seats[0] = occupiedSeat(0, { playerId: 'me', nickname: 'Me', ...seatOverrides })
  useRoomStore().applyRoomState(room)
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  usePlayerStore().setIdentity({ id: 'me', nickname: 'Me', avatar: '', chips: 1000 })
})

describe('useNextHandAction', () => {
  it('is hidden when the room is not awaiting next-hand readiness', () => {
    setRoom({ awaitingNextHandReady: false })
    expect(useNextHandAction().value.show).toBe(false)
  })

  it('is hidden while a hand is playing', () => {
    setRoom({ status: 'playing' })
    expect(useNextHandAction().value.show).toBe(false)
  })

  it('is hidden when I am not seated', () => {
    const room = makeRoom()
    room.seats[0] = { position: 0, status: 'empty' }
    useRoomStore().applyRoomState(room)
    expect(useNextHandAction().value.show).toBe(false)
  })

  it('shows 借筹码 when I am broke', () => {
    setRoom({}, { chips: 0 })
    const state = useNextHandAction().value
    expect(state.show).toBe(true)
    expect(state.label).toBe('借筹码')
    expect(state.disabled).toBe(false)
  })

  it('shows an enabled 准备 when funded and not ready', () => {
    setRoom({}, { chips: 1000, isReady: false })
    const state = useNextHandAction().value
    expect(state.show).toBe(true)
    expect(state.label).toBe('准备')
    expect(state.disabled).toBe(false)
  })

  it('shows a disabled 已准备 once funded and ready', () => {
    setRoom({}, { chips: 1000, isReady: true })
    const state = useNextHandAction().value
    expect(state.label).toBe('已准备')
    expect(state.disabled).toBe(true)
  })
})
