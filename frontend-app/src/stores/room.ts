/**
 * room.ts - Room state store.
 *
 * Maintains the current room from room:* / player:* socket events plus chat.
 * room:state broadcasts are authoritative; the fine-grained events apply
 * lightweight merges so the UI can react between broadcasts. Pure state and
 * transition logic only - no DOM, no animation.
 */

import { defineStore } from 'pinia'
import type {
  ChatMessagePayload,
  PlayerJoinedPayload,
  PlayerReadyPayload,
  PlayerUpdatedPayload,
  RoomSettledPayload,
  RoomSettlementPayload,
  RoomState,
  Settlement,
} from '@/types'

const MAX_CHAT_MESSAGES = 100

interface RoomStoreState {
  room: RoomState | null
  /**
   * Id of the room this client intends to be in, recorded on join intent
   * (view mount) and cleared on leave/reset. room:state snapshots for any
   * other id are dropped as stale.
   */
  currentRoomId: string | null
  /** Personal settlement from 'room:settlement' (leave / borrow). */
  settlement: Settlement | null
  settlementType: string | null
  settlementRoomDeleted: boolean
  /** Broadcast from 'room:settled' when the host left and the room closed. */
  roomSettled: RoomSettledPayload | null
  chatMessages: ChatMessagePayload[]
}

export const useRoomStore = defineStore('room', {
  state: (): RoomStoreState => ({
    room: null,
    currentRoomId: null,
    settlement: null,
    settlementType: null,
    settlementRoomDeleted: false,
    roomSettled: null,
    chatMessages: [],
  }),

  getters: {
    roomId: (state): string | null => state.room?.id ?? null,
    isInRoom: (state): boolean => state.room !== null,
    seatedCount: (state): number => state.room?.seatedCount ?? 0,
    isPlaying: (state): boolean => state.room?.status === 'playing',
  },

  actions: {
    /** Record the room this client is joining (null clears the guard). */
    setCurrentRoomId(id: string | null): void {
      this.currentRoomId = id
    },

    /**
     * Authoritative full-room snapshot. Snapshots for a different room id
     * than the one being joined are stale (e.g. a previous room's trailing
     * broadcast) and dropped.
     */
    applyRoomState(room: RoomState): void {
      if (this.currentRoomId !== null && room.id !== this.currentRoomId) return
      this.room = room
    },

    /**
     * 'player:joined' merge. seat.position is -1 when the player has not sat
     * yet: then only the players array is extended. Ledger fields follow the
     * joinRoom contract (chips = buyInTotal = room.initialChips, borrow 0);
     * the trailing room:state broadcast remains authoritative.
     */
    applyPlayerJoined(seat: PlayerJoinedPayload['seat']): void {
      if (!this.room) return
      if (this.room.players.some(p => p.playerId === seat.playerId)) return

      this.room.players.push({
        playerId: seat.playerId,
        nickname: seat.nickname,
        avatar: seat.avatar,
        seatPosition: seat.position,
        isReady: seat.isReady,
        chips: this.room.initialChips,
        buyInTotal: this.room.initialChips,
        borrowCount: 0,
        netResult: 0,
        isAI: false,
      })
      this.room.playerCount = this.room.players.length

      if (seat.position >= 0) {
        const slot = this.room.seats[seat.position]
        if (slot && slot.status === 'empty') {
          this.room.seats[seat.position] = {
            position: seat.position,
            status: 'occupied',
            playerId: seat.playerId,
            nickname: seat.nickname,
            avatar: seat.avatar,
            isReady: seat.isReady,
            chips: this.room.initialChips,
            buyInTotal: this.room.initialChips,
            borrowCount: 0,
            netResult: 0,
            isAI: false,
          }
          this.room.seatedCount = this.room.seats.filter(s => s.status === 'occupied').length
        }
      }
    },

    /**
     * 'player:left' merge: free the seat and drop the player entry.
     * position -1 (a player who never sat) is a silent no-op by design: the
     * fine-grained merge is only a broadcast-gap optimization and the
     * authoritative room:state arrives right after.
     */
    applyPlayerLeft(position: number): void {
      if (!this.room) return
      const slot = this.room.seats[position]
      if (slot && slot.status === 'occupied') {
        this.room.players = this.room.players.filter(p => p.playerId !== slot.playerId)
        this.room.seats[position] = { position, status: 'empty' }
        this.room.playerCount = this.room.players.length
        this.room.seatedCount = this.room.seats.filter(s => s.status === 'occupied').length
      }
    },

    /** 'player:ready' merge: update ready flag on seat and player entry. */
    applyPlayerReady(data: PlayerReadyPayload): void {
      if (!this.room) return
      const slot = this.room.seats[data.position]
      if (slot && slot.status === 'occupied') {
        slot.isReady = data.ready
      }
      const player = this.room.players.find(p => p.seatPosition === data.position)
      if (player) {
        player.isReady = data.ready
      }
    },

    /** 'player:updated' merge: nickname/avatar refresh for a room member. */
    applyPlayerUpdated(data: PlayerUpdatedPayload): void {
      if (!this.room) return
      const playerId = data.playerId ?? data.player?.id
      if (!playerId || !data.player) return
      const player = this.room.players.find(p => p.playerId === playerId)
      if (player) {
        player.nickname = data.player.nickname
        player.avatar = data.player.avatar
      }
      const seat = this.room.seats.find(s => s.status === 'occupied' && s.playerId === playerId)
      if (seat && seat.status === 'occupied') {
        seat.nickname = data.player.nickname
        seat.avatar = data.player.avatar
      }
    },

    /** 'room:settlement' — personal settlement (leave or borrow). */
    applySettlement(data: RoomSettlementPayload): void {
      this.settlement = data.settlement
      this.settlementType = data.type ?? null
      this.settlementRoomDeleted = Boolean(data.roomDeleted)
    },

    /** Clear a consumed personal settlement (e.g. after a borrow toast). */
    clearSettlement(): void {
      this.settlement = null
      this.settlementType = null
      this.settlementRoomDeleted = false
    },

    /** 'room:settled' — room closed (host left); clear the current room. */
    applyRoomSettled(data: RoomSettledPayload): void {
      this.roomSettled = data
      if (data.roomDeleted) {
        this.room = null
        this.currentRoomId = null
      }
    },

    appendChat(message: ChatMessagePayload): void {
      this.chatMessages.push(message)
      if (this.chatMessages.length > MAX_CHAT_MESSAGES) {
        this.chatMessages.splice(0, this.chatMessages.length - MAX_CHAT_MESSAGES)
      }
    },

    /** Reset all per-room state (e.g. after leaving). */
    resetRoom(): void {
      this.room = null
      this.currentRoomId = null
      this.settlement = null
      this.settlementType = null
      this.settlementRoomDeleted = false
      this.roomSettled = null
      this.chatMessages = []
    },
  },
})
