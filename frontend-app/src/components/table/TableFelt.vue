<script setup lang="ts">
/**
 * TableFelt.vue - The elliptical felt: seats ring, community cards, deck
 * marker, pot, turn timer and the hand-end settlement overlay. Store-driven
 * (game/room/player); pure layout math lives in utils/seat-layout.ts and
 * seat merging in seat-model.ts. Recomputes the layout on surface resize.
 * Emits sit / next-hand intents; the parent view talks to the socket
 * service. All animation hooks (data-seat-index, data-pot, data-deck,
 * .seat-ring) live here for the A5 GSAP stage.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useRoomStore } from '@/stores/room'
import { useGameStore } from '@/stores/game'
import type { OccupiedSeatInfo, SeatInfo } from '@/types'
import { computeSeatLayout, findSeatPoint } from '@/utils/seat-layout'
import { buildSeatModels } from '@/components/table/seat-model'
import SeatAvatar from '@/components/table/SeatAvatar.vue'
import CommunityCards from '@/components/table/CommunityCards.vue'
import PotDisplay from '@/components/table/PotDisplay.vue'
import TurnTimer from '@/components/table/TurnTimer.vue'
import HandResultOverlay from '@/components/table/HandResultOverlay.vue'
import PokerCard from '@/components/table/PokerCard.vue'
import { useTableAnimations } from '@/animations/useTableAnimations'
import { useTableSounds } from '@/audio/useTableSounds'

const emit = defineEmits<{
  sit: [position: number]
  nextHand: []
}>()

const playerStore = usePlayerStore()
const roomStore = useRoomStore()
const gameStore = useGameStore()

const room = computed(() => roomStore.room)

// ─── Elliptical layout, recomputed on surface resize ───────────────

const surfaceRef = ref<HTMLElement | null>(null)
const surfaceSize = ref({ width: 0, height: 0 })
let resizeObserver: ResizeObserver | null = null

// A5: watch game-store transitions and fire GSAP animations on the hooks
// (data-deck / data-pot / data-seat-index / ...) mounted in this subtree.
useTableAnimations(surfaceRef)

// Synthesized sound effects react to the same store transitions.
useTableSounds()

onMounted(() => {
  if (!surfaceRef.value) return
  resizeObserver = new ResizeObserver(entries => {
    const rect = entries[0]?.contentRect
    if (rect) surfaceSize.value = { width: rect.width, height: rect.height }
  })
  resizeObserver.observe(surfaceRef.value)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

const orientation = computed(() =>
  surfaceSize.value.height > surfaceSize.value.width ? 'portrait' : 'landscape',
)

const myRoomSeat = computed(() =>
  (room.value?.seats ?? []).find(
    (s): s is OccupiedSeatInfo => s.status === 'occupied' && s.playerId === playerStore.playerId,
  ),
)

const viewerSeatIndex = computed(
  () => gameStore.mySeatPosition ?? myRoomSeat.value?.position ?? null,
)

const seatCount = computed(() =>
  Math.max(room.value?.maxPlayers ?? 9, ...gameStore.players.map(p => p.seatPosition + 1), 2),
)

const layoutPoints = computed(() =>
  computeSeatLayout({
    seatCount: seatCount.value,
    viewerSeatIndex: viewerSeatIndex.value,
    width: surfaceSize.value.width,
    height: surfaceSize.value.height,
    orientation: orientation.value,
  }),
)

function seatStyle(seatIndex: number): Record<string, string> {
  const point = findSeatPoint(layoutPoints.value, seatIndex)
  if (!point) return { visibility: 'hidden' }
  return { left: `${point.x}px`, top: `${point.y}px` }
}

// ─── Seat view models ──────────────────────────────────────────────

const seatModels = computed(() =>
  buildSeatModels({
    maxPlayers: seatCount.value,
    roomSeats: room.value?.seats ?? ([] as SeatInfo[]),
    gamePlayers: gameStore.players,
    myPlayerId: playerStore.playerId,
    dealerPosition: gameStore.dealerPosition,
    smallBlindPos: gameStore.smallBlindPos,
    bigBlindPos: gameStore.bigBlindPos,
    currentPosition: gameStore.currentPosition,
    status: gameStore.status,
    showdownResults: gameStore.showdownResults,
    handResults: gameStore.handResults,
  }),
)

const canSit = computed(() => room.value !== null && room.value.status !== 'playing')

/** Legacy getVisibleSidePots: side pots only show with an all-in player. */
const visibleSidePots = computed(() =>
  gameStore.players.some(p => p.allIn) ? gameStore.pots.sidePots : [],
)

// ─── Transient per-seat action labels (game:action) ────────────────

const ACTION_NAMES: Record<string, string> = {
  fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注', allin: '全押',
}

const actionTexts = ref<Record<number, string>>({})
let actionTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => gameStore.lastAction,
  action => {
    if (!action) return
    let text = ACTION_NAMES[action.type] ?? action.type.toUpperCase()
    if (action.amount) text += ` ¥${action.amount.toLocaleString()}`
    actionTexts.value = { ...actionTexts.value, [action.position]: text }
    if (actionTimer) clearTimeout(actionTimer)
    actionTimer = setTimeout(() => {
      actionTexts.value = {}
    }, 1500)
  },
)

onUnmounted(() => {
  if (actionTimer) clearTimeout(actionTimer)
})

// ─── Hand-end overlay + legacy next-hand button state ──────────────

const overlayDismissed = ref(false)
watch(
  () => gameStore.status,
  status => {
    if (status === 'ended') overlayDismissed.value = false
  },
)
const showEndedOverlay = computed(() => gameStore.status === 'ended' && !overlayDismissed.value)

/** Legacy updateNextHandActionButton rules. */
const nextHandState = computed(() => {
  const seat = myRoomSeat.value
  const usable = Boolean(
    seat && room.value?.status !== 'playing' && room.value?.awaitingNextHandReady,
  )
  if (!usable || !seat) return { show: false, label: '', disabled: true, title: '' }
  const chips = Number(seat.chips) || 0
  const isReady = Boolean(seat.isReady)
  return {
    show: true,
    disabled: chips > 0 && isReady,
    label: chips <= 0 ? '借筹码' : isReady ? '已准备' : '准备',
    title:
      chips <= 0
        ? `每次借初始筹码 ¥${(room.value?.initialChips ?? 0).toLocaleString()}`
        : '所有玩家准备后自动开始下一局',
  }
})
</script>

<template>
  <section ref="surfaceRef" class="table-surface" data-table-surface>
    <div class="table-center">
      <PotDisplay
        :main-pot="gameStore.pots.mainPot"
        :side-pots="visibleSidePots"
        :total-pot="gameStore.totalPot"
      />
      <div class="community-row">
        <div class="deck-marker" data-deck aria-hidden="true">
          <PokerCard :card="null" size="sm" />
        </div>
        <CommunityCards :cards="gameStore.communityCards" />
      </div>
    </div>

    <SeatAvatar
      v-for="model in seatModels"
      :key="model.seatIndex"
      :seat="model"
      :can-sit="canSit"
      :action-text="actionTexts[model.seatIndex] ?? null"
      :style="seatStyle(model.seatIndex)"
      @sit="emit('sit', $event)"
    >
      <TurnTimer
        v-if="model.isCurrentTurn && gameStore.turnTimeoutAt !== null"
        :timeout-at="gameStore.turnTimeoutAt"
      />
    </SeatAvatar>

    <HandResultOverlay
      v-if="showEndedOverlay"
      :winners="gameStore.winners"
      :hand-results="gameStore.handResults"
      :show-next-hand="nextHandState.show"
      :next-hand-label="nextHandState.label"
      :next-hand-disabled="nextHandState.disabled"
      :next-hand-title="nextHandState.title"
      @next-hand="emit('nextHand')"
      @dismiss="overlayDismissed = true"
    />
  </section>
</template>

<style scoped>
.table-surface {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: radial-gradient(
    ellipse at center,
    var(--casino-green) 0%,
    var(--casino-green-deep) 100%
  );
}

.table-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--casino-space-3);
}

.community-row {
  display: flex;
  align-items: center;
  gap: var(--casino-space-3);
}

.deck-marker {
  opacity: 0.85;
  margin-right: var(--casino-space-2);
}
</style>
