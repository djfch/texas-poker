/**
 * player.ts - Current player identity store.
 *
 * Responsibilities (ported from frontend/js/app.js):
 * - Guest creation via REST and identity persistence in localStorage
 *   (key 'poker_player', JSON shape { id, nickname, avatar, chips }).
 * - Identity restore on app start and adoption of the server-bound identity
 *   from the 'connected' / 'player:updated' socket events.
 *
 * Socket (re)connection is deliberately NOT done here; services/socket.ts
 * orchestrates that so the import graph stays acyclic.
 */

import { defineStore } from 'pinia'
import type { ConnectedPayload, PlayerIdentity } from '@/types'
import * as api from '@/services/api'

export const PLAYER_STORAGE_KEY = 'poker_player'

interface PlayerStoreState {
  player: PlayerIdentity | null
}

function readStoredPlayer(): PlayerIdentity | null {
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PlayerIdentity>
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id) return null
    return {
      id: parsed.id,
      nickname: typeof parsed.nickname === 'string' ? parsed.nickname : '',
      avatar: typeof parsed.avatar === 'string' ? parsed.avatar : '',
      chips: typeof parsed.chips === 'number' ? parsed.chips : 0,
    }
  } catch {
    return null
  }
}

export const usePlayerStore = defineStore('player', {
  state: (): PlayerStoreState => ({
    player: null,
  }),

  getters: {
    playerId: (state): string | null => state.player?.id ?? null,
    nickname: (state): string => state.player?.nickname ?? '',
    isLoggedIn: (state): boolean => state.player !== null,
  },

  actions: {
    /** Persist identity and bind it to the REST layer. */
    setIdentity(player: PlayerIdentity): void {
      this.player = {
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        chips: player.chips,
      }
      api.setPlayerId(player.id)
      localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(this.player))
    },

    clearIdentity(): void {
      this.player = null
      api.setPlayerId(null)
      api.setToken(null)
      localStorage.removeItem(PLAYER_STORAGE_KEY)
    },

    /** Restore a persisted identity; returns it when valid. */
    restore(): PlayerIdentity | null {
      const stored = readStoredPlayer()
      if (!stored) {
        localStorage.removeItem(PLAYER_STORAGE_KEY)
        return null
      }
      this.setIdentity(stored)
      // Re-bind the persisted JWT to the REST layer after a reload.
      api.setToken(api.getToken())
      return stored
    },

    /** Create a guest via REST and adopt the returned identity. */
    async createGuest(): Promise<PlayerIdentity | null> {
      const result = await api.createGuest()
      if (result.success && result.data.player) {
        if (result.data.token) {
          api.setToken(result.data.token)
        }
        this.setIdentity(result.data.player)
        return this.player
      }
      return null
    },

    /** Ensure a usable identity exists, creating a guest when needed. */
    async ensureGuest(): Promise<PlayerIdentity | null> {
      if (this.player) return this.player
      return this.createGuest()
    },

    /**
     * Session-expired recovery: drop the stale identity and create a fresh
     * guest. Returns the new player id so the caller can rebind the socket.
     */
    async recreateGuest(): Promise<string | null> {
      this.clearIdentity()
      const guest = await this.createGuest()
      return guest?.id ?? null
    },

    /**
     * Adopt the identity bound by the server ('connected' event).
     * Mirrors the legacy app.js handler: prefer the full player record,
     * otherwise replace only the id when the server remapped it. A token
     * issued for a silently created guest is adopted as well.
     */
    handleConnected(data: ConnectedPayload): void {
      if (data.token) {
        api.setToken(data.token)
      }
      if (data.player && data.player.id) {
        this.setIdentity(data.player)
        return
      }
      if (data.playerId && this.player && this.player.id !== data.playerId) {
        this.setIdentity({ ...this.player, id: data.playerId })
      }
    },

    /** Merge a 'player:updated' record when it targets the current player. */
    applyUpdatedPlayer(player: PlayerIdentity | undefined): void {
      if (!player || !player.id || !this.player || player.id !== this.player.id) return
      this.setIdentity({ ...this.player, ...player })
    },
  },
})
