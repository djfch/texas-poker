/**
 * room.test.ts - Core state transitions of the room store driven by
 * room:* / player:* / chat events.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { OccupiedSeatInfo, RoomPlayer, RoomState, SeatInfo } from '@/types'
import { useRoomStore } from '@/stores/room'

function makeRoomPlayer(overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    playerId: 'p1',
    nickname: 'Host',
    avatar: '',
    seatPosition: 0,
    isReady: false,
    chips: 1000,
    buyInTotal: 1000,
    borrowCount: 0,
    netResult: 0,
    isAI: false,
    ...overrides,
  }
}

function makeOccupiedSeat(overrides: Partial<OccupiedSeatInfo> = {}): OccupiedSeatInfo {
  return {
    position: 0,
    status: 'occupied',
    playerId: 'p1',
    nickname: 'Host',
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
  const seats: SeatInfo[] = [makeOccupiedSeat()]
  for (let position = 1; position < 9; position += 1) {
    seats.push({ position, status: 'empty' })
  }
  return {
    id: 'room1',
    name: 'Test Room',
    hostId: 'p1',
    maxPlayers: 6,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: true,
    isPrivate: false,
    status: 'waiting',
    playerCount: 1,
    seatedCount: 1,
    createdAt: 1700000000000,
    dealerPosition: 0,
    awaitingNextHandReady: false,
    seats,
    players: [makeRoomPlayer()],
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('room state and seat transitions', () => {
  it('applyRoomState replaces the whole room', () => {
    const store = useRoomStore()
    store.applyRoomState(makeRoom())
    expect(store.room?.id).toBe('room1')
    expect(store.isInRoom).toBe(true)
  })

  it('drops room:state snapshots whose id does not match the joined room', () => {
    const store = useRoomStore()
    store.setCurrentRoomId('room1')

    store.applyRoomState(makeRoom({ id: 'room2' }))
    expect(store.room).toBeNull()

    store.applyRoomState(makeRoom())
    expect(store.room?.id).toBe('room1')
  })

  it('resetRoom clears the room id guard', () => {
    const store = useRoomStore()
    store.setCurrentRoomId('room1')
    store.resetRoom()

    store.applyRoomState(makeRoom({ id: 'room2' }))
    expect(store.room?.id).toBe('room2')
  })

  it('player:joined with position -1 only extends the players array', () => {
    const store = useRoomStore()
    store.applyRoomState(makeRoom())
    store.applyPlayerJoined({
      position: -1,
      playerId: 'p2',
      nickname: 'Guest2',
      avatar: '',
      isReady: false,
    })

    expect(store.room?.players).toHaveLength(2)
    expect(store.room?.playerCount).toBe(2)
    // Joining players start with a fresh initial stack per the join contract.
    expect(store.room?.players[1]?.chips).toBe(1000)
    // No seat is taken while position is -1.
    expect(store.room?.seats.filter(s => s.status === 'occupied')).toHaveLength(1)
  })

  it('player:joined seated fills the seat and both counts', () => {
    const store = useRoomStore()
    store.applyRoomState(makeRoom())
    store.applyPlayerJoined({
      position: 2,
      playerId: 'p2',
      nickname: 'Guest2',
      avatar: '',
      isReady: false,
    })

    const seat = store.room?.seats[2]
    expect(seat?.status).toBe('occupied')
    expect(store.room?.seatedCount).toBe(2)
    expect(store.room?.playerCount).toBe(2)
  })

  it('player:left frees the seat and drops the player', () => {
    const store = useRoomStore()
    store.applyRoomState(makeRoom())
    store.applyPlayerLeft(0)

    expect(store.room?.seats[0]?.status).toBe('empty')
    expect(store.room?.players).toHaveLength(0)
    expect(store.room?.seatedCount).toBe(0)
  })

  it('player:ready flips ready on seat and player entry', () => {
    const store = useRoomStore()
    store.applyRoomState(makeRoom())
    store.applyPlayerReady({ position: 0, ready: true })

    const seat = store.room?.seats[0]
    expect(seat?.status === 'occupied' && seat.isReady).toBe(true)
    expect(store.room?.players[0]?.isReady).toBe(true)
  })

  it('player:updated refreshes nickname in seat and player entry', () => {
    const store = useRoomStore()
    store.applyRoomState(makeRoom())
    store.applyPlayerUpdated({
      player: { id: 'p1', nickname: 'NewName', avatar: 'a2', chips: 1000 },
    })

    const seat = store.room?.seats[0]
    expect(seat?.status === 'occupied' && seat.nickname).toBe('NewName')
    expect(store.room?.players[0]?.nickname).toBe('NewName')
  })
})

describe('settlements and chat', () => {
  it('room:settlement stores the personal settlement', () => {
    const store = useRoomStore()
    store.applySettlement({
      roomId: 'room1',
      settlement: {
        playerId: 'p1',
        nickname: 'Host',
        seatPosition: 0,
        chips: 2000,
        buyInTotal: 1000,
        borrowCount: 0,
        netResult: 1000,
      },
      type: 'borrow',
    })

    expect(store.settlement?.netResult).toBe(1000)
    expect(store.settlementType).toBe('borrow')
  })

  it('room:settled with roomDeleted clears the current room', () => {
    const store = useRoomStore()
    store.applyRoomState(makeRoom())
    store.applyRoomSettled({
      roomId: 'room1',
      settlements: [],
      roomDeleted: true,
      reason: 'host_left',
    })

    expect(store.room).toBeNull()
    expect(store.roomSettled?.reason).toBe('host_left')
  })

  it('chat history is appended and capped at 100 messages', () => {
    const store = useRoomStore()
    for (let i = 0; i < 105; i += 1) {
      store.appendChat({ from: 'p1', text: `msg-${i}`, timestamp: i })
    }

    expect(store.chatMessages).toHaveLength(100)
    expect(store.chatMessages[0]?.text).toBe('msg-5')
  })

  it('resetRoom clears room, settlements and chat', () => {
    const store = useRoomStore()
    store.applyRoomState(makeRoom())
    store.appendChat({ from: 'p1', text: 'hi', timestamp: 1 })
    store.resetRoom()

    expect(store.room).toBeNull()
    expect(store.chatMessages).toEqual([])
    expect(store.settlement).toBeNull()
    expect(store.roomSettled).toBeNull()
  })
})
