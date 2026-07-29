<script setup lang="ts">
/**
 * HistoryDrawer.vue - Right-side hand history drawer (Vant Popup).
 * The game store keeps no per-action log, so the drawer shows the latest
 * hand's showdown reveals (cards + hand names) and settlement deltas, as
 * the task allows. Store-driven like ActionBar.
 */
import { computed } from 'vue'
import type { HandResultEntry } from '@/types'
import { useGameStore } from '@/stores/game'

defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const gameStore = useGameStore()

function formatSigned(value: number | undefined): string {
  const n = Number(value || 0)
  return `${n >= 0 ? '+' : '-'}¥${Math.abs(n).toLocaleString()}`
}

function resultName(r: HandResultEntry): string {
  return r.nickname || `座位 ${r.position + 1}`
}

const hasRecords = computed(
  () => gameStore.showdownResults.length > 0 || (gameStore.handResults?.length ?? 0) > 0,
)
</script>

<template>
  <van-popup
    :show="show"
    position="right"
    class="history-popup"
    @update:show="emit('update:show', $event)"
  >
    <div class="history-content">
      <div class="history-title">牌局记录</div>

      <template v-if="hasRecords">
        <div v-if="gameStore.showdownResults.length" class="history-section">
          <div class="section-title">摊牌</div>
          <div
            v-for="(r, i) in gameStore.showdownResults"
            :key="i"
            class="history-row"
          >
            <span class="row-name">
              {{ 'nickname' in r && r.nickname ? r.nickname : `座位 ${r.position + 1}` }}
            </span>
            <span class="row-cards">{{ r.cards.join(' ') }}</span>
            <span v-if="r.handName" class="row-hand">{{ r.handName }}</span>
          </div>
        </div>

        <div v-if="gameStore.handResults?.length" class="history-section">
          <div class="section-title">结算</div>
          <div v-for="r in gameStore.handResults" :key="r.playerId" class="history-row">
            <span class="row-name">{{ resultName(r) }}</span>
            <span
              class="row-delta"
              :class="r.delta >= 0 ? 'delta-positive' : 'delta-negative'"
            >
              {{ formatSigned(r.delta) }}
            </span>
          </div>
        </div>
      </template>

      <div v-else class="history-empty">暂无牌局记录</div>
    </div>
  </van-popup>
</template>

<style scoped>
.history-popup {
  width: 320px;
  height: 100%;
  background: var(--casino-green-deep);
}

.history-content {
  padding: var(--casino-space-4);
}

.history-title {
  font-family: var(--casino-font-title);
  font-size: var(--casino-font-size-lg);
  color: var(--casino-gold);
  margin-bottom: var(--casino-space-4);
}

.history-section {
  margin-bottom: var(--casino-space-4);
}

.section-title {
  font-size: var(--casino-font-size-sm);
  color: var(--casino-ivory-dim);
  border-bottom: 1px solid rgba(245, 240, 225, 0.12);
  padding-bottom: var(--casino-space-1);
  margin-bottom: var(--casino-space-2);
}

.history-row {
  display: flex;
  align-items: center;
  gap: var(--casino-space-2);
  padding: var(--casino-space-1) 0;
  font-size: var(--casino-font-size-sm);
}

.row-name {
  color: var(--casino-ivory);
  font-weight: 600;
}

.row-cards {
  flex: 1;
  color: var(--casino-ivory-dim);
}

.row-hand {
  color: var(--casino-gold-light);
  font-size: var(--casino-font-size-xs);
}

.delta-positive {
  color: var(--casino-gold-light);
  font-weight: 700;
}

.delta-negative {
  color: var(--casino-danger);
  font-weight: 700;
}

.history-empty {
  color: var(--casino-ivory-dim);
  font-size: var(--casino-font-size-sm);
  text-align: center;
  padding: var(--casino-space-6) 0;
}
</style>
