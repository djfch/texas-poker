/**
 * lobby.test.ts - Lobby store flows: room list loading plus the create/join
 * sequences (REST first, then WS room:join). The socket service is mocked so
 * no real connection is attempted; fetch is mocked for REST.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { RoomState } from '@/types'
import { useLobbyStore } from '@/stores/lobby'
import { usePlayerStore } from '@/stores/player'
import { joinRoom as socketJoinRoom } from '@/services/socket'

vi.mock('@/services/socket', () => ({
  joinRoom: vi.fn(() => true),
}))

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeRoom(id: string): RoomState {
  return {
    id,
    name: 'R',
    hostId: 'p1',
    maxPlayers: 6,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 1000,
    allowAI: true,
    isPrivate: false,
    status: 'waiting',
    playerCount: 1,
    seatedCount: 0,
    createdAt: 1,
    dealerPosition: 0,
    awaitingNextHandReady: false,
    seats: [],
    players: [],
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  vi.mocked(socketJoinRoom).mockClear()
  usePlayerStore().setIdentity({ id: 'p1', nickname: 'P1', avatar: '', chips: 1000 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('room list', () => {
  it('loadRooms fills the list on success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, rooms: [makeRoom('r1')] }))
    await useLobbyStore().loadRooms()

    expect(useLobbyStore().rooms).toHaveLength(1)
    expect(useLobbyStore().loading).toBe(false)
    expect(useLobbyStore().error).toBeNull()
  })

  it('loadRooms keeps the error message on failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { success: false, error: 'boom' }))
    await useLobbyStore().loadRooms()

    expect(useLobbyStore().rooms).toEqual([])
    expect(useLobbyStore().error).toBe('boom')
  })
})

describe('create and join flows', () => {
  it('createRoom joins over the socket after REST success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, room: makeRoom('r9') }))
    const room = await useLobbyStore().createRoom({ name: 'R' })

    expect(room?.id).toBe('r9')
    expect(socketJoinRoom).toHaveBeenCalledWith('r9')
  })

  it('createRoom retries once with a fresh guest on "Player not found"', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404, { success: false, error: 'Player not found' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          success: true,
          player: { id: 'g-new', nickname: 'Guest', avatar: '', chips: 1000 },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { success: true, room: makeRoom('r10') }))

    const room = await useLobbyStore().createRoom({ name: 'R' })

    expect(room?.id).toBe('r10')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // The retry carried the freshly created identity.
    const [, retryOptions] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(retryOptions.headers).toMatchObject({ 'x-player-id': 'g-new' })
  })

  it('joinById returns null and keeps the error on REST failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { success: false, error: 'Invalid password' }))
    const room = await useLobbyStore().joinById('r1', 'wrong')

    expect(room).toBeNull()
    expect(useLobbyStore().error).toBe('Invalid password')
    expect(socketJoinRoom).not.toHaveBeenCalled()
  })

  it('joinById joins over the socket after REST success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, room: makeRoom('r2') }))
    const room = await useLobbyStore().joinById('r2', 'pw')

    expect(room?.id).toBe('r2')
    expect(socketJoinRoom).toHaveBeenCalledWith('r2', 'pw')
  })
})
