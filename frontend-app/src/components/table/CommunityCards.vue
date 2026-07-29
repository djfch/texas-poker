<script setup lang="ts">
/**
 * CommunityCards.vue - The five community card slots at the table center.
 * Undealt streets render an empty dashed placeholder (legacy shows only the
 * dealt cards; the slots reserve layout space and serve as animation
 * targets for A5).
 */
import PokerCard from '@/components/table/PokerCard.vue'

withDefaults(
  defineProps<{
    /** CardString list for the current street (0-5 entries). */
    cards: string[]
    size?: 'sm' | 'md' | 'lg'
  }>(),
  { size: 'md' },
)
</script>

<template>
  <div class="community-cards" data-community>
    <div
      v-for="i in 5"
      :key="i"
      class="community-slot"
      :class="{ 'slot-filled': Boolean(cards[i - 1]) }"
      :data-community-index="i - 1"
    >
      <PokerCard v-if="cards[i - 1]" :card="cards[i - 1]!" :size="size" />
    </div>
  </div>
</template>

<style scoped>
.community-cards {
  display: flex;
  gap: var(--casino-space-2);
  justify-content: center;
}

.community-slot {
  width: 48px;
  aspect-ratio: 5 / 7;
  border-radius: var(--casino-radius-sm);
}

.slot-filled {
  width: auto;
  aspect-ratio: auto;
}

.community-slot:not(.slot-filled) {
  border: 1px dashed rgba(245, 240, 225, 0.18);
  background: rgba(0, 0, 0, 0.15);
}

.community-slot:has(.card-size-sm) {
  width: 32px;
}

.community-slot:has(.card-size-lg) {
  width: 64px;
}
</style>
