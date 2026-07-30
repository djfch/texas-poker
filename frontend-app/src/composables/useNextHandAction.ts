/**
 * useNextHandAction.ts - Shared between-hands action-button state
 * (准备 / 已准备 / 借筹码) for the next-hand ready flow. Store-driven only, so
 * both the hand-end overlay and the persistent table footer render the same
 * control and stay in sync. This is the fix for the "收起 then stuck" bug:
 * dismissing the overlay must never leave the player without a way to ready
 * up or borrow chips, so the footer keeps this button while the room awaits
 * next-hand readiness. Mirrors legacy updateNextHandActionButton rules.
 */
import { computed, type ComputedRef } from 'vue'
import type { OccupiedSeatInfo } from '@/types'
import { usePlayerStore } from '@/stores/player'
import { useRoomStore } from '@/stores/room'

export interface NextHandActionState {
  /** Whether the ready/borrow button should be shown at all. */
  show: boolean
  /** Disabled once a funded player is already ready. */
  disabled: boolean
  label: string
  title: string
}

export function useNextHandAction(): ComputedRef<NextHandActionState> {
  const playerStore = usePlayerStore()
  const roomStore = useRoomStore()

  return computed(() => {
    const room = roomStore.room
    const seat = (room?.seats ?? []).find(
      (s): s is OccupiedSeatInfo =>
        s.status === 'occupied' && s.playerId === playerStore.playerId,
    )
    const usable = Boolean(seat && room?.status !== 'playing' && room?.awaitingNextHandReady)
    if (!usable || !seat) {
      return { show: false, disabled: true, label: '', title: '' }
    }

    const chips = Number(seat.chips) || 0
    const isReady = Boolean(seat.isReady)
    return {
      show: true,
      disabled: chips > 0 && isReady,
      label: chips <= 0 ? '借筹码' : isReady ? '已准备' : '准备',
      title:
        chips <= 0
          ? `每次借初始筹码 ¥${(room?.initialChips ?? 0).toLocaleString()}`
          : '所有玩家准备后自动开始下一局',
    }
  })
}
