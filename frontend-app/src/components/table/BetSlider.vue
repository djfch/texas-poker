<script setup lang="ts">
/**
 * BetSlider.vue - Raise/bet amount picker: numeric input, Vant slider and
 * quick buttons. Replicates the legacy raise wrapper (min = min-raise,
 * max = all chips, step = big blind) with the legacy quick buttons
 * 最小/半池/满池/最大 clamped into [min, max].
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number
    min: number
    max: number
    /** Step size (big blind). */
    step?: number
    /** Total pot, used by the 半池/满池 quick buttons. */
    pot?: number
  }>(),
  { step: 1, pot: 0 },
)

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const sliderValue = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', clamp(value)),
})

function clamp(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return props.min
  return Math.min(Math.max(n, props.min), props.max)
}

const quickOptions = computed(() => [
  { label: '最小', value: props.min },
  { label: '半池', value: Math.floor(props.pot / 2) },
  { label: '满池', value: props.pot },
  { label: '最大', value: props.max },
])

function onInput(event: Event): void {
  emit('update:modelValue', clamp((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="bet-slider" data-bet-slider>
    <input
      class="raise-input"
      type="number"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      data-testid="raise-input"
      @input="onInput"
    />
    <div class="raise-quick-buttons">
      <button
        v-for="opt in quickOptions"
        :key="opt.label"
        class="quick-btn"
        type="button"
        @click="emit('update:modelValue', clamp(opt.value))"
      >
        {{ opt.label }}
      </button>
    </div>
    <van-slider
      v-model="sliderValue"
      :min="min"
      :max="max"
      :step="step"
      bar-height="4px"
      active-color="var(--casino-gold)"
      data-testid="raise-slider"
    />
  </div>
</template>

<style scoped>
.bet-slider {
  display: flex;
  flex-direction: column;
  gap: var(--casino-space-2);
  min-width: 180px;
  padding: 0 var(--casino-space-1);
}

.raise-input {
  width: 100%;
  box-sizing: border-box;
  text-align: center;
  font-size: var(--casino-font-size-md);
  font-weight: 700;
  padding: var(--casino-space-1);
  color: var(--casino-ivory);
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--casino-gold-deep);
  border-radius: var(--casino-radius-sm);
}

.raise-quick-buttons {
  display: flex;
  gap: var(--casino-space-1);
  justify-content: center;
}

.quick-btn {
  padding: 2px var(--casino-space-2);
  font-size: 10px;
  color: var(--casino-ivory);
  background: rgba(245, 240, 225, 0.1);
  border: 1px solid rgba(245, 240, 225, 0.25);
  border-radius: var(--casino-radius-sm);
  cursor: pointer;
}

.quick-btn:hover {
  background: rgba(245, 240, 225, 0.2);
}
</style>
