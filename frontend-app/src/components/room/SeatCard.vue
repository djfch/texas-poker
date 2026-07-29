<script setup lang="ts">
/**
 * SeatCard.vue - One seat in the waiting-room grid.
 * Occupied: avatar (🤖 for AI), nickname, AI badge, chips, ready badge and
 * the host-only remove-AI button. Empty: seat number plus the sit button.
 */
import { computed } from 'vue'
import type { SeatInfo } from '@/types'

const props = defineProps<{
  seat: SeatInfo
  isMe: boolean
  /** Host-only: allow removing this AI seat while the room is waiting. */
  canRemoveAI: boolean
}>()

const emit = defineEmits<{
  sit: [position: number]
  removeAI: [position: number]
}>()

const occupied = computed(() => props.seat.status === 'occupied')

const isReady = computed(() => props.seat.status === 'occupied' && props.seat.isReady)

const avatarChar = computed(() => {
  if (props.seat.status !== 'occupied') return ''
  if (props.seat.isAI) return '🤖'
  return props.seat.nickname ? props.seat.nickname.charAt(0).toUpperCase() : '?'
})

const avatarColor = computed(() =>
  props.seat.status === 'occupied' && props.seat.avatar ? props.seat.avatar : '#3498db',
)

const chipsText = computed(() =>
  props.seat.status === 'occupied' ? Number(props.seat.chips || 0).toLocaleString() : '',
)
</script>

<template>
  <div
    class="seat"
    :class="{ 'seat-me': isMe, 'seat-empty': !occupied, 'seat-ready': isReady }"
    :data-testid="`seat-${seat.position}`"
  >
    <template v-if="!occupied">
      <span class="seat-number">座位 {{ seat.position + 1 }}</span>
      <van-button
        size="small"
        plain
        type="primary"
        :data-testid="`btn-sit-${seat.position}`"
        @click="emit('sit', seat.position)"
      >
        坐下
      </van-button>
    </template>

    <template v-else-if="seat.status === 'occupied'">
      <div class="seat-avatar" :style="{ background: avatarColor }">{{ avatarChar }}</div>
      <div class="seat-info">
        <span class="seat-name">{{ seat.nickname || '玩家' }}</span>
        <span v-if="seat.isAI" class="seat-ai-badge">AI</span>
      </div>
      <span class="seat-chips">¥{{ chipsText }}</span>
      <span v-if="seat.isReady" class="seat-ready-badge">已准备</span>
      <van-button
        v-if="canRemoveAI"
        size="mini"
        plain
        type="danger"
        :data-testid="`btn-remove-ai-${seat.position}`"
        @click="emit('removeAI', seat.position)"
      >
        移除AI
      </van-button>
    </template>
  </div>
</template>

<style scoped>
.seat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--casino-space-2);
  min-height: 120px;
  padding: var(--casino-space-3);
  background: var(--casino-green-deep);
  border: 1px solid var(--casino-gold-deep);
  border-radius: var(--casino-radius-md);
  box-shadow: var(--casino-shadow-sm);
}

.seat-me {
  border-color: var(--casino-gold);
  box-shadow: var(--casino-shadow-gold);
}

.seat-empty {
  border-style: dashed;
  background: rgba(13, 59, 43, 0.6);
}

.seat-number {
  color: var(--casino-ivory-dim);
  font-size: var(--casino-font-size-xs);
}

.seat-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--casino-card-white);
  font-weight: 700;
  font-size: var(--casino-font-size-md);
  border: 2px solid var(--casino-gold-deep);
}

.seat-info {
  display: flex;
  align-items: center;
  gap: var(--casino-space-1);
}

.seat-name {
  color: var(--casino-ivory);
  font-size: var(--casino-font-size-sm);
  max-width: 7em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seat-ai-badge {
  padding: 0 var(--casino-space-1);
  font-size: 10px;
  color: var(--casino-ink);
  background: var(--casino-gold);
  border-radius: var(--casino-radius-sm);
}

.seat-chips {
  color: var(--casino-gold-light);
  font-size: var(--casino-font-size-xs);
}

.seat-ready-badge {
  padding: 1px var(--casino-space-2);
  font-size: 10px;
  color: var(--casino-green-deep);
  background: var(--casino-gold-light);
  border-radius: var(--casino-radius-pill);
}
</style>
