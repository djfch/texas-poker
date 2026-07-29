<script setup lang="ts">
/**
 * HandResultOverlay.vue - Settlement overlay shown when a hand ends
 * (game:ended). Lists winners (nickname, hand name, payout) and every
 * player's signed delta, plus the legacy next-hand action button
 * (准备/已准备/借筹码 while the room awaits next-hand readiness).
 * Dismissible so the settled table stays inspectable.
 */
import { computed } from 'vue'
import type { HandResultEntry, WinnerInfo } from '@/types'

const props = withDefaults(
  defineProps<{
    winners: WinnerInfo[] | null
    handResults: HandResultEntry[] | null
    /** Next-hand button state; null hides the button. */
    nextHandLabel?: string
    nextHandDisabled?: boolean
    nextHandTitle?: string
    showNextHand?: boolean
  }>(),
  {
    nextHandLabel: '',
    nextHandDisabled: true,
    nextHandTitle: '',
    showNextHand: false,
  },
)

const emit = defineEmits<{
  nextHand: []
  dismiss: []
}>()

function formatSigned(value: number | undefined): string {
  const n = Number(value || 0)
  return `${n >= 0 ? '+' : '-'}¥${Math.abs(n).toLocaleString()}`
}

const sortedResults = computed(() =>
  [...(props.handResults ?? [])].sort((a, b) => b.delta - a.delta),
)
</script>

<template>
  <div class="hand-result-overlay" data-testid="hand-result-overlay">
    <div class="overlay-panel">
      <div class="overlay-title">本局结算</div>

      <div v-if="winners?.length" class="winner-list">
        <div v-for="w in winners" :key="w.playerId" class="winner-row">
          <span class="winner-name">{{ w.nickname || '玩家' }}</span>
          <span v-if="w.hand" class="winner-hand">{{ w.hand }}</span>
          <span class="winner-amount">{{ formatSigned(w.payout || w.amount) }}</span>
        </div>
      </div>

      <div v-if="sortedResults.length" class="result-list">
        <div
          v-for="r in sortedResults"
          :key="r.playerId"
          class="result-row"
          :class="{ 'result-winner': r.isWinner }"
        >
          <span class="result-name">{{ r.nickname || '玩家' }}</span>
          <span
            class="result-delta"
            :class="r.delta >= 0 ? 'result-positive' : 'result-negative'"
          >
            {{ formatSigned(r.delta) }}
          </span>
        </div>
      </div>

      <div class="overlay-actions">
        <van-button
          v-if="showNextHand"
          size="small"
          type="primary"
          :disabled="nextHandDisabled"
          :title="nextHandTitle"
          data-testid="btn-next-hand"
          @click="emit('nextHand')"
        >
          {{ nextHandLabel }}
        </van-button>
        <van-button size="small" plain data-testid="btn-dismiss-overlay" @click="emit('dismiss')">
          收起
        </van-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hand-result-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  z-index: var(--casino-z-overlay);
}

.overlay-panel {
  min-width: 260px;
  max-width: 90%;
  max-height: 80%;
  overflow-y: auto;
  padding: var(--casino-space-4) var(--casino-space-5);
  background: var(--casino-green-deep);
  border: 1px solid var(--casino-gold-deep);
  border-radius: var(--casino-radius-lg);
  box-shadow: var(--casino-shadow-lg);
}

.overlay-title {
  font-family: var(--casino-font-title);
  font-size: var(--casino-font-size-lg);
  color: var(--casino-gold);
  text-align: center;
  margin-bottom: var(--casino-space-3);
}

.winner-list {
  display: flex;
  flex-direction: column;
  gap: var(--casino-space-2);
  margin-bottom: var(--casino-space-3);
}

.winner-row {
  display: flex;
  align-items: center;
  gap: var(--casino-space-2);
  padding: var(--casino-space-2) var(--casino-space-3);
  border-radius: var(--casino-radius-md);
  background: rgba(212, 175, 55, 0.12);
  border: 1px solid var(--casino-gold-deep);
}

.winner-name {
  font-weight: 600;
  color: var(--casino-ivory);
}

.winner-hand {
  flex: 1;
  font-size: var(--casino-font-size-xs);
  color: var(--casino-ivory-dim);
}

.winner-amount,
.result-positive {
  color: var(--casino-gold-light);
  font-weight: 700;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: var(--casino-space-1);
}

.result-row {
  display: flex;
  justify-content: space-between;
  gap: var(--casino-space-4);
  font-size: var(--casino-font-size-sm);
}

.result-name {
  color: var(--casino-ivory);
}

.result-negative {
  color: var(--casino-danger);
  font-weight: 700;
}

.overlay-actions {
  display: flex;
  justify-content: center;
  gap: var(--casino-space-3);
  margin-top: var(--casino-space-4);
}
</style>
