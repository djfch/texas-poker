<script setup lang="ts">
/**
 * SettlementDialog.vue - Settlement panel shown after leaving a room
 * (personal settlement) or when the room is closed (all settlements).
 * Row fields mirror the legacy settlement modal: net result (signed,
 * colored), current chips, total buy-in and borrow count.
 */
import type { Settlement } from '@/types'

defineProps<{
  show: boolean
  title: string
  settlements: Settlement[]
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  confirm: []
}>()

function formatNumber(value: number | undefined): string {
  return Number(value || 0).toLocaleString()
}

function formatSigned(value: number | undefined): string {
  const n = Number(value || 0)
  return `${n >= 0 ? '+' : '-'}¥${Math.abs(n).toLocaleString()}`
}

function onConfirm(): void {
  emit('update:show', false)
  emit('confirm')
}
</script>

<template>
  <van-dialog
    :show="show"
    :title="title"
    confirm-button-text="返回大厅"
    data-testid="settlement-dialog"
    @update:show="emit('update:show', $event)"
    @confirm="onConfirm"
  >
    <div class="settlement-list">
      <div v-for="s in settlements" :key="s.playerId" class="settlement-row">
        <div class="settlement-head">
          <span class="settlement-name">{{ s.nickname || '玩家' }}</span>
          <span
            class="settlement-result"
            :class="Number(s.netResult || 0) >= 0 ? 'result-positive' : 'result-negative'"
          >
            {{ formatSigned(s.netResult) }}
          </span>
        </div>
        <div class="settlement-fields">
          <span>当前筹码: ¥{{ formatNumber(s.chips) }}</span>
          <span>累计买入: ¥{{ formatNumber(s.buyInTotal) }}</span>
          <span>借码次数: {{ Number(s.borrowCount) || 0 }}</span>
        </div>
      </div>
    </div>
  </van-dialog>
</template>

<style scoped>
.settlement-list {
  display: flex;
  flex-direction: column;
  gap: var(--casino-space-3);
  max-height: 50vh;
  overflow-y: auto;
}

.settlement-row {
  padding: var(--casino-space-3);
  border: 1px solid var(--casino-gold-deep);
  border-radius: var(--casino-radius-md);
  background: var(--casino-felt-bg);
}

.settlement-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.settlement-name {
  color: var(--casino-ivory);
  font-weight: 600;
}

.settlement-result {
  font-weight: 700;
}

.result-positive {
  color: var(--casino-gold-light);
}

.result-negative {
  color: var(--casino-danger);
}

.settlement-fields {
  display: flex;
  flex-direction: column;
  gap: var(--casino-space-1);
  margin-top: var(--casino-space-2);
  font-size: var(--casino-font-size-xs);
  color: var(--casino-ivory-dim);
}
</style>
