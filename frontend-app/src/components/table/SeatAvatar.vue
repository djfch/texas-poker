<script setup lang="ts">
/**
 * SeatAvatar.vue - One seat on the poker table: avatar circle, nickname,
 * chips, current-street bet, dealer/blind markers and status display
 * (folded greyed out, all-in badge, AI thinking note). The current actor is
 * highlighted via the `.seat-ring` element (animation mount point, A5).
 * Empty seats show a dashed placeholder with a sit button.
 */
import { computed } from 'vue'
import type { TableSeatModel } from '@/components/table/seat-model'
import PokerCard from '@/components/table/PokerCard.vue'

const props = defineProps<{
  seat: TableSeatModel
  /** Sitting is only possible while the room is not playing. */
  canSit: boolean
  /** Transient action label (e.g. '加注 ¥200') from game:action. */
  actionText?: string | null
}>()

const emit = defineEmits<{
  sit: [position: number]
}>()

const avatarChar = computed(() => {
  if (props.seat.isAI) return '🤖'
  return props.seat.nickname ? props.seat.nickname.charAt(0).toUpperCase() : '?'
})

const statusLabel = computed(() => {
  if (props.seat.allIn) return '全押'
  if (props.seat.folded) return '已弃牌'
  return ''
})

const resultText = computed(() => {
  const delta = props.seat.resultDelta
  if (delta === null) return ''
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : ''
  return `${sign}¥${Math.abs(delta).toLocaleString()}`
})
</script>

<template>
  <div
    class="table-seat"
    :class="{
      'seat-empty': seat.empty,
      'seat-me': seat.isMe,
      'seat-turn': seat.isCurrentTurn,
      'seat-folded': seat.folded,
      'seat-allin': seat.allIn,
      'seat-winner': seat.isWinner,
      'seat-loser': seat.resultDelta !== null && !seat.isWinner,
    }"
    :data-seat-index="seat.seatIndex"
  >
    <!-- Animation mount point: pulsing ring for the current actor (A5). -->
    <div class="seat-ring" :data-seat-index="seat.seatIndex" aria-hidden="true" />

    <template v-if="seat.empty">
      <button
        v-if="canSit"
        class="btn-sit"
        :data-testid="`btn-table-sit-${seat.seatIndex}`"
        @click="emit('sit', seat.seatIndex)"
      >
        入座
      </button>
    </template>

    <template v-else>
      <div class="seat-inner">
        <div class="seat-markers">
          <span v-if="seat.isDealer" class="marker marker-dealer">D</span>
          <span v-if="seat.isSmallBlind" class="marker marker-sb">SB</span>
          <span v-if="seat.isBigBlind" class="marker marker-bb">BB</span>
        </div>

        <div class="seat-avatar" :style="{ background: seat.avatar || '#3498db' }">
          {{ avatarChar }}
        </div>
        <div class="seat-name">{{ seat.nickname || '玩家' }}</div>
        <div class="seat-chips">¥{{ Number(seat.chips || 0).toLocaleString() }}</div>
        <span v-if="statusLabel" class="seat-status">{{ statusLabel }}</span>
        <span v-if="seat.thinking" class="thinking-indicator">思考中...</span>

        <div v-if="seat.revealedCards" class="seat-cards">
          <PokerCard
            v-for="(card, i) in seat.revealedCards"
            :key="i"
            :card="card"
            size="sm"
          />
        </div>
        <div v-if="seat.handName" class="seat-hand-name">{{ seat.handName }}</div>
        <div
          v-if="seat.resultDelta !== null"
          class="seat-hand-result"
          :class="seat.resultDelta >= 0 ? 'seat-result-positive' : 'seat-result-negative'"
        >
          {{ resultText }}
        </div>
      </div>

      <div v-if="seat.bet > 0" class="seat-bet" data-seat-bet>
        <span class="seat-bet-amount">¥{{ seat.bet.toLocaleString() }}</span>
      </div>

      <div v-if="actionText" class="action-text" data-action-text>{{ actionText }}</div>

      <!-- Overlay slot: the turn timer mounts here for the acting seat. -->
      <slot />
    </template>
  </div>
</template>
<style scoped src="./seat-avatar.css"></style>
