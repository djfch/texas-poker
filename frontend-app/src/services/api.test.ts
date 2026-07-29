/**
 * api.test.ts - Error-convention tests for the typed REST wrapper.
 * fetch is mocked; no real HTTP happens.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/services/api'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  localStorage.clear()
  api.setPlayerId(null)
  api.setToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('request wrapper conventions', () => {
  it('returns { success: true, data } with the raw body on HTTP 2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, rooms: [] }))
    const result = await api.getRooms()
    expect(result).toEqual({ success: true, data: { success: true, rooms: [] } })
  })

  it('returns backend error message and status on HTTP error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { success: false, error: 'Room not found' }))
    const result = await api.getRoom('nope')
    expect(result).toEqual({ success: false, error: 'Room not found', status: 404 })
  })

  it('falls back to body.message when error is absent', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { message: 'bad request' }))
    const result = await api.getRooms()
    expect(result).toEqual({ success: false, error: 'bad request', status: 400 })
  })

  it('falls back to "HTTP <status>" when the body has no error text', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}))
    const result = await api.getRooms()
    expect(result).toEqual({ success: false, error: 'HTTP 500', status: 500 })
  })

  it('returns the exception message on network failure (no status)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'))
    const result = await api.getRooms()
    expect(result).toEqual({ success: false, error: 'connection refused' })
  })

  it('survives non-JSON error bodies', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 502 }))
    const result = await api.getRooms()
    expect(result).toEqual({ success: false, error: 'HTTP 502', status: 502 })
  })
})

describe('headers and body', () => {
  it('omits x-player-id until setPlayerId is called', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, rooms: [] }))
    await api.getRooms()
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(options.headers).not.toHaveProperty('x-player-id')
  })

  it('attaches x-player-id after setPlayerId', async () => {
    api.setPlayerId('p-123')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, rooms: [] }))
    await api.getRooms()
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(options.headers).toMatchObject({ 'x-player-id': 'p-123' })
  })

  it('attaches Authorization Bearer after setToken, alongside x-player-id', async () => {
    api.setPlayerId('p-123')
    api.setToken('jwt-abc')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, rooms: [] }))
    await api.getRooms()
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(options.headers).toMatchObject({
      'x-player-id': 'p-123',
      Authorization: 'Bearer jwt-abc',
    })
  })

  it('persists the token to localStorage and clears it on setToken(null)', async () => {
    api.setToken('jwt-abc')
    expect(localStorage.getItem(api.TOKEN_STORAGE_KEY)).toBe('jwt-abc')
    expect(api.getToken()).toBe('jwt-abc')

    api.setToken(null)
    expect(localStorage.getItem(api.TOKEN_STORAGE_KEY)).toBeNull()
    expect(api.getToken()).toBeNull()
  })

  it('sends JSON body on POST and none on GET', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }))
    await api.createRoom({ name: 'test', maxPlayers: 6 })
    const [url, postOptions] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/rooms')
    expect(postOptions.method).toBe('POST')
    expect(postOptions.body).toBe(JSON.stringify({ name: 'test', maxPlayers: 6 }))

    await api.getRooms()
    const [, getOptions] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(getOptions.method).toBe('GET')
    expect(getOptions.body).toBeUndefined()
  })
})

describe('endpoint paths', () => {
  it('maps every legacy method to its backend path', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }))
    await api.createGuest()
    await api.register('u', 'p')
    await api.login('u', 'p')
    await api.getRooms()
    await api.createRoom({})
    await api.getRoom('abc123')
    await api.joinRoom('abc123', 'pw')

    const calls = fetchMock.mock.calls.map(([url, options]) => [
      (options as RequestInit).method,
      url,
    ])
    expect(calls).toEqual([
      ['POST', '/api/auth/guest'],
      ['POST', '/api/auth/register'],
      ['POST', '/api/auth/login'],
      ['GET', '/api/rooms'],
      ['POST', '/api/rooms'],
      ['GET', '/api/rooms/abc123'],
      ['POST', '/api/rooms/abc123/join'],
    ])
  })
})
