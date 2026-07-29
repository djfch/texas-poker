<script setup lang="ts">
/**
 * PotDisplay.vue - Main pot plus side-pot list at the table center.
 * Legacy semantics (frontend/js/components/pot.js): the primary number is
 * the total pot (explicit totalPot when finite, otherwise main + sides);
 * side pots are listed as detail rows ("边池 N"). Number-count animation is
 * an A5 concern - the container carries the data-pot hook.
 */
import { computed } from 'vue'
import type { SidePot } from '@/types'

const props = withDefaults(
  defineProps<{
    mainPot: number
    /** Pre-filtered side pots (legacy only shows them with an all-in). */
    sidePots?: SidePot[]
    totalPot?: number | null
  }>(),
  { sidePots: () => [], totalPot: null },
)

function toAmount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const resolvedTotal = computed(() => {
  // Legacy resolveTotalPot: explicit finite totalPot wins; null/absent and
  // non-finite values fall back to main + sides.
  if (props.totalPot !== null && props.totalPot !== undefined) {
    const explicit = Number(props.totalPot)
    if (Number.isFinite(explicit)) return explicit
  }
  return toAmount(props.mainPot) + props.sidePots.reduce((sum, sp) => sum + toAmount(sp?.amount), 0)
})

function formatAmount(amount: number): string {
  return `¥${toAmount(amount).toLocaleString()}`
}
</script>

<template>
  <div class="pot-container" data-pot data-testid="pot-display">
    <div class="pot-main">
      <span class="pot-label">底池</span>
      <span class="pot-value" data-testid="pot-value">{{ formatAmount(resolvedTotal) }}</span>
    </div>
    <div v-if="sidePots.length" class="pot-sides">
      <div v-for="(sp, i) in sidePots" :key="i" class="pot-side" data-testid="side-pot">
        <span class="pot-side-label">边池 {{ i + 1 }}</span>
        <span class="pot-side-value">{{ formatAmount(sp.amount) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pot-container {
  text-align: center;
}

.pot-main {
  display: inline-flex;
  flex-direction: column;
  padding: var(--casino-space-2) var(--casino-space-5);
  border-radius: var(--casino-radius-pill);
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--casino-gold-deep);
}

.pot-label {
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--casino-ivory-dim);
}

.pot-value {
  font-size: var(--casino-font-size-lg);
  font-weight: 800;
  color: var(--casino-gold-light);
}

.pot-sides {
  display: flex;
  gap: var(--casino-space-3);
  justify-content: center;
  margin-top: var(--casino-space-1);
}

.pot-side {
  font-size: var(--casino-font-size-xs);
  color: var(--casino-ivory-dim);
}

.pot-side-value {
  margin-left: var(--casino-space-1);
  color: var(--casino-gold-light);
  font-weight: 600;
}
</style>
