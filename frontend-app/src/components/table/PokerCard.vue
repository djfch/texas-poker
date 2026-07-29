<script setup lang="ts">
/**
 * PokerCard.vue - Single playing card backed by the bundled SVG assets
 * (utils/card-asset.ts). Accepts either wire format: CardJSON ({ suit, rank })
 * or CardString ('A♠' / '10♥'). Null/unparseable cards and faceDown render
 * the card back. The face and back SVGs have slightly different aspect
 * ratios, so the img uses object-fit: fill inside a fixed 5/7 box.
 */
import { computed } from 'vue'
import type { CardJSON, CardRank } from '@/types'
import { getCardAsset, getCardBackAsset, type CardSuit } from '@/utils/card-asset'
import { parseCardString } from '@/utils/card-string'

const RANK_VALUES: Record<CardRank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14,
}

const props = withDefaults(
  defineProps<{
    /** CardJSON or CardString; null/undefined renders the back. */
    card?: CardJSON | string | null
    /** Force the card back even when a face is available. */
    faceDown?: boolean
    /** Width preset in px. */
    size?: 'sm' | 'md' | 'lg'
  }>(),
  { card: null, faceDown: false, size: 'md' },
)

const normalized = computed<CardJSON | null>(() => {
  const card = props.card
  if (!card) return null
  if (typeof card === 'string') return parseCardString(card)
  return card
})

const rankValue = computed<number | null>(() => {
  const rank = normalized.value?.rank
  return rank ? (RANK_VALUES[rank] ?? null) : null
})

const faceUp = computed(() => !props.faceDown && normalized.value !== null)

const imageSrc = computed(() => {
  if (!faceUp.value) return getCardBackAsset()
  const suit = normalized.value!.suit as CardSuit
  try {
    return getCardAsset(suit, rankValue.value!)
  } catch {
    return getCardBackAsset()
  }
})

const altText = computed(() =>
  faceUp.value ? `${normalized.value!.rank}${normalized.value!.suit}` : 'card back',
)
</script>

<template>
  <div
    class="poker-card"
    :class="[`card-size-${size}`, { 'card-face-down': !faceUp }]"
    :data-suit="faceUp ? normalized!.suit : undefined"
    :data-rank="faceUp ? normalized!.rank : undefined"
    :data-face="faceUp ? 'up' : 'down'"
  >
    <img class="card-image" :src="imageSrc" :alt="altText" draggable="false" />
  </div>
</template>

<style scoped>
.poker-card {
  border-radius: var(--casino-radius-sm);
  box-shadow: var(--casino-shadow-sm);
  overflow: hidden;
  flex-shrink: 0;
  aspect-ratio: 5 / 7;
  background: var(--casino-card-white);
}

.card-size-sm {
  width: 32px;
}

.card-size-md {
  width: 48px;
}

.card-size-lg {
  width: 64px;
}

.card-image {
  width: 100%;
  height: 100%;
  display: block;
  /* Face/back SVG ratios differ slightly; fill keeps both in the same box. */
  object-fit: fill;
  user-select: none;
}
</style>
