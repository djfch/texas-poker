/**
 * api.ts - Typed REST wrapper, ported from frontend/js/api.js.
 *
 * Conventions preserved from the legacy client:
 * - Same-origin base URL (dev server proxies /api to the backend).
 * - x-player-id header attached when an identity is set via setPlayerId.
 * - Every call resolves to ApiResult<T>: { success: true, data } on HTTP 2xx,
 *   { success: false, error, status? } otherwise. `data` is the raw response
 *   body (which itself carries a `success` flag from the backend).
 */

import type {
  ApiResult,
  CreateRoomConfig,
  JoinRoomResponseBody,
  PlayerResponseBody,
  RoomResponseBody,
  RoomsResponseBody,
} from '@/types'

const BASE_URL = ''

export const TOKEN_STORAGE_KEY = 'poker_token'

let playerId: string | null = null
let authToken: string | null = null

/** Set the current player id used for the x-player-id header (null to clear). */
export function setPlayerId(id: string | null): void {
  playerId = id
}

/** Read the persisted JWT (survives reloads; module state is transient). */
function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

/** Set the JWT used for the Authorization header; persisted to localStorage. */
export function setToken(token: string | null): void {
  authToken = token
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token)
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  } catch {
    // storage unavailable (private mode): keep the in-memory token only
  }
}

/** Current JWT: in-memory value first, then the persisted one. */
export function getToken(): string | null {
  return authToken ?? readStoredToken()
}

/** Generic request wrapper with the legacy error convention. */
export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (playerId) {
    headers['x-player-id'] = playerId
  }
  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const options: RequestInit = {
    method: method.toUpperCase(),
    headers,
  }
  if (body && method.toUpperCase() !== 'GET') {
    options.body = JSON.stringify(body)
  }

  try {
    const response = await fetch(`${BASE_URL}${path}`, options)
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

    if (!response.ok) {
      const message =
        (typeof data.error === 'string' && data.error) ||
        (typeof data.message === 'string' && data.message) ||
        `HTTP ${response.status}`
      return { success: false, error: message, status: response.status }
    }

    return { success: true, data: data as T }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    }
  }
}

// ─── Auth ────────────────────────────────────────────────────────

export function createGuest(): Promise<ApiResult<PlayerResponseBody>> {
  return request<PlayerResponseBody>('POST', '/api/auth/guest')
}

export function register(
  username: string,
  password: string,
): Promise<ApiResult<PlayerResponseBody>> {
  return request<PlayerResponseBody>('POST', '/api/auth/register', { username, password })
}

export function login(
  username: string,
  password: string,
): Promise<ApiResult<PlayerResponseBody>> {
  return request<PlayerResponseBody>('POST', '/api/auth/login', { username, password })
}

// ─── Rooms ───────────────────────────────────────────────────────

export function getRooms(): Promise<ApiResult<RoomsResponseBody>> {
  return request<RoomsResponseBody>('GET', '/api/rooms')
}

export function createRoom(config: CreateRoomConfig): Promise<ApiResult<RoomResponseBody>> {
  return request<RoomResponseBody>('POST', '/api/rooms', config)
}

export function getRoom(roomId: string): Promise<ApiResult<RoomResponseBody>> {
  return request<RoomResponseBody>('GET', `/api/rooms/${roomId}`)
}

export function joinRoom(
  roomId: string,
  password?: string,
): Promise<ApiResult<JoinRoomResponseBody>> {
  return request<JoinRoomResponseBody>('POST', `/api/rooms/${roomId}/join`, { password })
}

// ─── User ────────────────────────────────────────────────────────

// Backend exposes no /api/user/* routes; the former profile/history
// endpoints were removed to keep this module in lockstep with the
// server contract.

/** Object-style facade mirroring the legacy `API` module shape. */
export const api = {
  setPlayerId,
  setToken,
  getToken,
  request,
  createGuest,
  register,
  login,
  getRooms,
  createRoom,
  getRoom,
  joinRoom,
}
