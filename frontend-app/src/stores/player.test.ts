/**
 * player.test.ts - Identity lifecycle of the player store: guest creation,
 * localStorage persistence/restore, server identity adoption, and the
 * session-expired guest recreation path. fetch is mocked for REST calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlayerStore, PLAYER_STORAGE_KEY } from '@/stores/player'
import * as api from '@/services/api'

const GUEST = { id: 'g-1', nickname: 'Guest-1', avatar: 'a', chips: 1000 }

function guestResponse(player = GUEST): Response {
  return new Response(JSON.stringify({ success: true, player }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  api.setPlayerId(null)
  api.setToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('persistence', () => {
  it('restore returns null when nothing is stored', () => {
    expect(usePlayerStore().restore()).toBeNull()
    expect(usePlayerStore().player).toBeNull()
  })

  it('restore adopts a valid stored identity', () => {
    localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(GUEST))
    const restored = usePlayerStore().restore()

    expect(restored?.id).toBe('g-1')
    expect(usePlayerStore().player?.nickname).toBe('Guest-1')
  })

  it('restore drops corrupt storage', () => {
    localStorage.setItem(PLAYER_STORAGE_KEY, '{broken json')
    expect(usePlayerStore().restore()).toBeNull()
    expect(localStorage.getItem(PLAYER_STORAGE_KEY)).toBeNull()
  })

  it('setIdentity persists to localStorage', () => {
    usePlayerStore().setIdentity(GUEST)
    expect(JSON.parse(localStorage.getItem(PLAYER_STORAGE_KEY) ?? '{}')).toEqual(GUEST)
  })
})

describe('guest creation', () => {
  it('createGuest adopts the REST identity and persists it', async () => {
    fetchMock.mockResolvedValueOnce(guestResponse())
    const guest = await usePlayerStore().createGuest()

    expect(guest?.id).toBe('g-1')
    expect(usePlayerStore().player?.nickname).toBe('Guest-1')
    expect(localStorage.getItem(PLAYER_STORAGE_KEY)).not.toBeNull()

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/guest')
    expect(options.method).toBe('POST')
  })

  it('createGuest stores the issued guest token', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, player: GUEST, token: 'guest-jwt' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await usePlayerStore().createGuest()

    expect(api.getToken()).toBe('guest-jwt')
    expect(localStorage.getItem(api.TOKEN_STORAGE_KEY)).toBe('guest-jwt')
  })

  it('createGuest failure keeps the store empty', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await usePlayerStore().createGuest()).toBeNull()
    expect(usePlayerStore().player).toBeNull()
  })

  it('recreateGuest clears the stale identity and returns the new id', async () => {
    const store = usePlayerStore()
    store.setIdentity(GUEST)
    fetchMock.mockResolvedValueOnce(guestResponse({ ...GUEST, id: 'g-2' }))

    const newId = await store.recreateGuest()
    expect(newId).toBe('g-2')
    expect(store.playerId).toBe('g-2')
  })
})

describe('server identity adoption', () => {
  it('handleConnected prefers the full player record', () => {
    const store = usePlayerStore()
    store.setIdentity(GUEST)
    store.handleConnected({
      playerId: 'g-1',
      player: { id: 'g-1', nickname: 'Renamed', avatar: 'b', chips: 500 },
    })

    expect(store.player?.nickname).toBe('Renamed')
    expect(store.player?.chips).toBe(500)
  })

  it('handleConnected adopts a server-issued token when present', () => {
    const store = usePlayerStore()
    store.handleConnected({ playerId: 'g-1', player: GUEST, token: 'fresh-jwt' })

    expect(api.getToken()).toBe('fresh-jwt')
    expect(localStorage.getItem(api.TOKEN_STORAGE_KEY)).toBe('fresh-jwt')
  })

  it('clearIdentity drops the stored token as well', () => {
    const store = usePlayerStore()
    store.setIdentity(GUEST)
    api.setToken('guest-jwt')

    store.clearIdentity()
    expect(api.getToken()).toBeNull()
    expect(localStorage.getItem(api.TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('handleConnected replaces only the id when the server remapped it', () => {
    const store = usePlayerStore()
    store.setIdentity(GUEST)
    store.handleConnected({ playerId: 'g-9', player: undefined as never })

    expect(store.player?.id).toBe('g-9')
    expect(store.player?.nickname).toBe('Guest-1')
  })

  it('applyUpdatedPlayer merges only records for the current player', () => {
    const store = usePlayerStore()
    store.setIdentity(GUEST)

    store.applyUpdatedPlayer({ id: 'someone-else', nickname: 'X', avatar: '', chips: 0 })
    expect(store.player?.nickname).toBe('Guest-1')

    store.applyUpdatedPlayer({ id: 'g-1', nickname: 'Me2', avatar: 'a', chips: 1000 })
    expect(store.player?.nickname).toBe('Me2')
  })
})
