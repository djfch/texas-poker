/**
 * socket.ts - Socket.IO client singleton, ported from frontend/js/socket-client.js.
 *
 * Preserved semantics:
 * - Same-origin connection, transports websocket -> polling fallback.
 * - Auto-reconnect: at most 5 attempts, delay 1s growing to 5s.
 * - On (re)connect: retry a pending room:join, and when we believe we are in
 *   a room, emit game:request_state so the server pushes room:state +
 *   game:state for full recovery. The server rebinds our playerId from the
 *   connection query, which is seeded from the persisted localStorage player.
 * - Server 'error' with code PLAYER_UNKNOWN means the stored identity is
 *   gone (server restart): a fresh guest is created and the socket rebinds.
 *
 * Server events are dispatched into the Pinia stores via socket-dispatch.ts;
 * a tiny local pub/sub (on/off/once) remains for lifecycle events
 * ('connect', 'disconnect', 'connect_error', 'error', 'session_expired').
 */

import { io, type Socket } from 'socket.io-client'
import { WS_CLIENT_EVENTS } from '@/types'
import type { GameActionRequestPayload, GameActionType } from '@/types'
import { usePlayerStore, PLAYER_STORAGE_KEY } from '@/stores/player'
import { attachServerEventDispatch } from '@/services/socket-dispatch'
import { getToken } from '@/services/api'

const MAX_RECONNECT_ATTEMPTS = 5

let socket: Socket | null = null
let reconnectAttempts = 0
let pendingRoomId: string | null = null
let pendingPassword: string | null = null
let currentRoomId: string | null = null

type LocalHandler = (data: unknown) => void
const localListeners = new Map<string, Set<LocalHandler>>()

/** Read the persisted player id used to rebind identity on (re)connect. */
function readStoredPlayerId(): string | null {
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { id?: unknown }
    return typeof parsed.id === 'string' && parsed.id ? parsed.id : null
  } catch {
    return null
  }
}

// ─── Connection lifecycle ────────────────────────────────────────

export function connect(playerId?: string | null): void {
  if (socket && socket.connected) return
  disconnect()

  const id = playerId ?? readStoredPlayerId()
  const token = getToken()
  socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    // JWT is the authoritative identity; the query playerId stays as the
    // legacy fallback the server still honors during the compat window.
    ...(token ? { auth: { token } } : {}),
    ...(id ? { query: { playerId: id } } : {}),
  })

  attachLifecycleHandlers(socket)
  attachServerEventDispatch(socket, { emitLocal, recoverExpiredSession })
}

export function disconnect(): void {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
}

export function isConnected(): boolean {
  return socket !== null && socket.connected
}

export function getSocket(): Socket | null {
  return socket
}

function attachLifecycleHandlers(instance: Socket): void {
  instance.on('connect', () => {
    reconnectAttempts = 0
    emitLocal('connect', { socketId: instance.id })

    // Retry a pending room join interrupted by the disconnect.
    if (pendingRoomId) {
      emit(WS_CLIENT_EVENTS.JOIN_ROOM, {
        roomId: pendingRoomId,
        password: pendingPassword ?? undefined,
      })
    }

    // In a room: ask for the authoritative snapshots (reconnect recovery).
    if (currentRoomId) {
      emit(WS_CLIENT_EVENTS.REQUEST_STATE)
    }
  })

  instance.on('disconnect', (reason: string) => {
    emitLocal('disconnect', { reason })
  })

  instance.on('connect_error', (err: Error) => {
    reconnectAttempts += 1
    emitLocal('connect_error', { error: err.message, attempt: reconnectAttempts })
  })
}

/** PLAYER_UNKNOWN: recreate a guest, then rebind the socket identity. */
async function recoverExpiredSession(): Promise<void> {
  const playerStore = usePlayerStore()
  const newId = await playerStore.recreateGuest()
  if (newId) {
    disconnect()
    connect(newId)
  }
}

// ─── Emitters ────────────────────────────────────────────────────

export function emit(event: string, payload?: unknown): boolean {
  if (!socket || !socket.connected) {
    return false
  }
  socket.emit(event, payload)
  return true
}

export function joinRoom(roomId: string, password?: string): boolean {
  pendingRoomId = roomId
  pendingPassword = password ?? null
  currentRoomId = roomId
  return emit(WS_CLIENT_EVENTS.JOIN_ROOM, { roomId, password })
}

export function leaveRoom(): boolean {
  pendingRoomId = null
  pendingPassword = null
  currentRoomId = null
  return emit(WS_CLIENT_EVENTS.LEAVE_ROOM)
}

export function sit(position: number): boolean {
  return emit(WS_CLIENT_EVENTS.SIT, { position })
}

export function stand(): boolean {
  return emit(WS_CLIENT_EVENTS.STAND)
}

export function ready(isReady: boolean): boolean {
  return emit(WS_CLIENT_EVENTS.READY, { ready: isReady })
}

export function borrowChips(): boolean {
  return emit(WS_CLIENT_EVENTS.BORROW_CHIPS)
}

export function addAI(): boolean {
  return emit(WS_CLIENT_EVENTS.ADD_AI)
}

export function removeAI(position: number): boolean {
  return emit(WS_CLIENT_EVENTS.REMOVE_AI, { position })
}

export function startGame(): boolean {
  return emit(WS_CLIENT_EVENTS.START_GAME)
}

export function updateNickname(nickname: string): boolean {
  return emit(WS_CLIENT_EVENTS.UPDATE_NICKNAME, { nickname })
}

export function gameAction(type: GameActionType, amount?: number): boolean {
  const payload: GameActionRequestPayload = { type }
  if (amount !== undefined && amount !== null) {
    payload.amount = amount
  }
  return emit(WS_CLIENT_EVENTS.GAME_ACTION, payload)
}

export function sendChat(text: string): boolean {
  return emit(WS_CLIENT_EVENTS.CHAT_MESSAGE, { text })
}

export function requestGameState(): boolean {
  return emit(WS_CLIENT_EVENTS.REQUEST_STATE)
}

export function setCurrentRoom(roomId: string | null): void {
  currentRoomId = roomId
  if (!roomId) {
    pendingRoomId = null
    pendingPassword = null
  }
}

// ─── Local lifecycle pub/sub ─────────────────────────────────────

export function on(event: string, callback: LocalHandler): void {
  if (!localListeners.has(event)) {
    localListeners.set(event, new Set())
  }
  localListeners.get(event)?.add(callback)
}

export function off(event: string, callback?: LocalHandler): void {
  const listeners = localListeners.get(event)
  if (!listeners) return
  if (callback) {
    listeners.delete(callback)
  } else {
    listeners.clear()
  }
}

export function once(event: string, callback: LocalHandler): void {
  const wrapper: LocalHandler = data => {
    off(event, wrapper)
    callback(data)
  }
  on(event, wrapper)
}

function emitLocal(event: string, data: unknown): void {
  const listeners = localListeners.get(event)
  if (!listeners) return
  for (const callback of listeners) {
    try {
      callback(data)
    } catch (err) {
      console.error('[Socket] Error in listener for', event, err)
    }
  }
}

/** Composable accessor over the singleton socket service. */
export function useSocket() {
  return {
    connect,
    disconnect,
    isConnected,
    getSocket,
    emit,
    joinRoom,
    leaveRoom,
    sit,
    stand,
    ready,
    borrowChips,
    addAI,
    removeAI,
    startGame,
    updateNickname,
    gameAction,
    sendChat,
    requestGameState,
    setCurrentRoom,
    on,
    off,
    once,
  }
}
