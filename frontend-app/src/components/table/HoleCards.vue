<script setup lang="ts">
/**
 * HoleCards.vue - The viewer's own two hole cards in the bottom bar.
 * Falls back to face-down backs when no cards have been dealt yet.
 */
import type { CardJSON } from '@/types'
import PokerCard from '@/components/table/PokerCard.vue'

withDefaults(
  defineProps<{
    /** Structured hole cards from the game store; empty before the deal. */
    cards: CardJSON[]
    size?: 'sm' | 'md' | 'lg'
  }>(),
  { size: 'lg' },
)
</script>

<template>
  <div class="hole-cards" data-hole-cards>
    <PokerCard
      v-for="i in 2"
      :key="i"
      :card="cards[i - 1] ?? null"
      :face-down="!cards[i - 1]"
      :size="size"
      :data-testid="`hole-card-${i - 1}`"
    />
  </div>
</template>

<style scoped>
.hole-cards {
  display: flex;
  gap: var(--casino-space-2);
}
</style>
