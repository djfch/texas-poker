<script setup lang="ts">
/**
 * TurnTimer.vue - 30s action countdown ring (SVG circle, stroke-dashoffset).
 * Replicates legacy frontend/js/components/timer.js: ticks every 100ms from
 * the server's timeoutAt, turns warning (red, blinking text) at <=10s and
 * expired at 0. Driven by the game store's turnTimeoutAt via the parent.
 */
import { computed, onUnmounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Absolute server timestamp when the turn expires; null stops the ring. */
    timeoutAt: number | null
    duration?: number
    warning?: number
    size?: number
  }>(),
  { duration: 30000, warning: 10000, size: 46 },
)

const RADIUS = 26
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const remaining = ref(props.duration)
let intervalId: ReturnType<typeof setInterval> | null = null

function stop(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

function tick(): void {
  if (props.timeoutAt === null) return
  remaining.value = Math.max(0, props.timeoutAt - Date.now())
  if (remaining.value <= 0) stop()
}

watch(
  () => props.timeoutAt,
  () => {
    stop()
    if (props.timeoutAt === null) return
    tick()
    intervalId = setInterval(tick, 100)
  },
  { immediate: true },
)

onUnmounted(stop)

const dashOffset = computed(() => {
  const elapsed = Math.min(props.duration, props.duration - remaining.value)
  return (CIRCUMFERENCE * elapsed) / props.duration
})

const seconds = computed(() => Math.ceil(remaining.value / 1000))
const isWarning = computed(() => remaining.value > 0 && remaining.value <= props.warning)
const isExpired = computed(() => remaining.value <= 0)
</script>

<template>
  <div
    class="turn-timer"
    :class="{ 'timer-warning': isWarning, 'timer-expired': isExpired }"
    :style="{ width: `${size}px`, height: `${size}px` }"
    data-turn-timer
  >
    <svg class="timer-ring" viewBox="0 0 60 60">
      <circle class="timer-track" cx="30" cy="30" :r="RADIUS" />
      <circle
        class="timer-progress"
        cx="30"
        cy="30"
        :r="RADIUS"
        :stroke-dasharray="`${CIRCUMFERENCE} ${CIRCUMFERENCE}`"
        :stroke-dashoffset="dashOffset"
      />
    </svg>
    <span class="timer-text">{{ seconds }}</span>
  </div>
</template>

<style scoped>
.turn-timer {
  position: absolute;
  top: -18px;
  right: -18px;
  z-index: 2;
  pointer-events: none;
}

.timer-ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.timer-track {
  fill: none;
  stroke: rgba(245, 240, 225, 0.15);
  stroke-width: 4;
}

.timer-progress {
  fill: none;
  stroke: var(--casino-gold);
  stroke-width: 4;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.1s linear;
}

.timer-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: var(--casino-font-size-sm);
  font-weight: 700;
  color: var(--casino-card-white);
}

.timer-warning .timer-progress {
  stroke: var(--casino-danger);
}

.timer-warning .timer-text {
  color: var(--casino-danger);
}

.timer-expired .timer-progress {
  stroke: var(--casino-danger);
  opacity: 0.3;
}
</style>
