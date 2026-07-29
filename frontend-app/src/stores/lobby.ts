/**
 * lobby.ts - Lobby store: public room list plus create/join flows.
 *
 * Flow semantics follow the legacy frontend/js/views/lobby.js:
 * - createRoom: REST POST /api/rooms (retry once with a fresh guest when the
 *   stored identity expired on the server), then WS room:join.
 * - joinById: REST POST /api/rooms/:id/join, then WS room:join.
 * Navigation after a successful create/join is left to the view layer.
 */

import { defineStore } from 'pinia'
import type { CreateRoomConfig, RoomState } from '@/types'
import * as api from '@/services/api'
import { joinRoom as socketJoinRoom } from '@/services/socket'
import { usePlayerStore } from '@/stores/player'

interface LobbyStoreState {
  rooms: RoomState[]
  loading: boolean
  error: string | null
}

export const useLobbyStore = defineStore('lobby', {
  state: (): LobbyStoreState => ({
    rooms: [],
    loading: false,
    error: null,
  }),

  getters: {
    isEmpty: (state): boolean => !state.loading && state.rooms.length === 0,
  },

  actions: {
    /** Load (or refresh) the public waiting-room list. */
    async loadRooms(): Promise<void> {
      this.loading = true
      this.error = null
      try {
        const result = await api.getRooms()
        if (result.success) {
          this.rooms = result.data.rooms ?? []
        } else {
          this.error = result.error
        }
      } finally {
        this.loading = false
      }
    },

    async refresh(): Promise<void> {
      return this.loadRooms()
    },

    /**
     * Create a room and join it over the socket. Returns the created room so
     * the caller can navigate; null on failure (error kept in state).
     */
    async createRoom(config: CreateRoomConfig): Promise<RoomState | null> {
      this.error = null
      let result = await api.createRoom(config)

      // The stored identity may have expired server-side (in-memory store
      // restart): recreate a guest once, then retry, as the legacy app did.
      if (!result.success && result.error === 'Player not found') {
        const playerStore = usePlayerStore()
        await playerStore.recreateGuest()
        result = await api.createRoom(config)
      }

      if (!result.success || !result.data.room) {
        this.error = result.success ? 'Create room failed' : result.error
        return null
      }

      const room = result.data.room
      socketJoinRoom(room.id)
      return room
    },

    /**
     * Join a room by id (optionally with password). Returns the joined room
     * so the caller can navigate; null on failure (error kept in state).
     */
    async joinById(roomId: string, password?: string): Promise<RoomState | null> {
      this.error = null
      const result = await api.joinRoom(roomId, password)
      if (!result.success) {
        this.error = result.error
        return null
      }
      socketJoinRoom(roomId, password)
      return result.data.room ?? null
    },
  },
})
