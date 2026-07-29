<script setup lang="ts">
/**
 * ActionBar.vue - Betting action buttons driven by the game store's
 * validActions (private game:turn). Replicates legacy actions.js: buttons
 * are ordered 弃牌/过牌/跟注/下注/加注/全押, call and all-in labels carry
 * amounts, and the bar only renders on the viewer's own turn (hidden again
 * right after an action is emitted). Bet/raise amounts come from the
 * embedded BetSlider and are clamped into [minAmount, maxAmount].
 */
import { computed, ref, watch } from 'vue'
import { showToast } from 'vant'
import type { ValidAction } from '@/types'
import { useGameStore } from '@/stores/game'
import { useRoomStore } from '@/stores/room'
import BetSlider from '@/components/table/BetSlider.vue'

const emit = defineEmits<{
  action: [type: string, amount?: number]
}>()

const gameStore = useGameStore()
const roomStore = useRoomStore()

/** Slider step = the room's big blind (1 until the room snapshot arrives). */
const bigBlindStep = computed(() => Math.max(1, roomStore.room?.bigBlind ?? 1))

const ACTION_ORDER: Record<string, number> = {
  fold: 0, check: 1, call: 2, bet: 3, raise: 4, allin: 5,
}

const sortedActions = computed<ValidAction[]>(() =>
  [...gameStore.validActions].sort(
    (a, b) => (ACTION_ORDER[a.type] ?? 99) - (ACTION_ORDER[b.type] ?? 99),
  ),
)

const myChips = computed(() => gameStore.me?.chips ?? 0)

type RaiseAction = Extract<ValidAction, { type: 'bet' | 'raise' }>

function isRaiseAction(action: ValidAction): action is RaiseAction {
  return action.type === 'raise' || action.type === 'bet'
}

const raiseAction = computed(() => sortedActions.value.find(isRaiseAction) ?? null)

const raiseAmount = ref(0)

/** Locally dismissed after a click, like the legacy ActionsComponent.hide. */
const dismissed = ref(false)

const visible = computed(
  () => gameStore.isMyTurn && gameStore.validActions.length > 0 && !dismissed.value,
)

watch(
  () => gameStore.validActions,
  actions => {
    dismissed.value = false
    raiseAmount.value = actions.find(isRaiseAction)?.minAmount ?? 0
  },
  { immediate: true },
)

interface ActionButton {
  type: string
  label: string
  className: string
}

const buttons = computed<ActionButton[]>(() =>
  sortedActions.value.map(action => {
    switch (action.type) {
      case 'fold':
        return { type: 'fold', label: '弃牌', className: 'action-fold' }
      case 'check':
        return { type: 'check', label: '过牌', className: 'action-check' }
      case 'call': {
        const amount = action.amount ?? gameStore.currentBet
        return { type: 'call', label: `跟注 ${formatAmount(amount)}`, className: 'action-call' }
      }
      case 'bet':
        return { type: 'bet', label: '下注', className: 'action-bet' }
      case 'raise':
        return { type: 'raise', label: '加注', className: 'action-raise' }
      case 'allin':
        return { type: 'allin', label: `全押 ${formatAmount(myChips.value)}`, className: 'action-allin' }
    }
  }),
)

function formatAmount(value: number | undefined): string {
  return `¥${Number(value || 0).toLocaleString()}`
}

function onClick(type: string): void {
  if (type === 'bet' || type === 'raise') {
    if (!raiseAction.value) return
    const { minAmount, maxAmount } = raiseAction.value
    const amount = Math.max(minAmount, Math.min(raiseAmount.value, maxAmount))
    if (amount < minAmount) {
      showToast(`金额至少为 ${formatAmount(minAmount)}`)
      return
    }
    dismissed.value = true
    emit('action', type, amount)
    return
  }
  dismissed.value = true
  if (type === 'call') {
    const call = sortedActions.value.find(a => a.type === 'call')
    emit('action', 'call', call && 'amount' in call ? call.amount : gameStore.currentBet)
    return
  }
  emit('action', type)
}
</script>

<template>
  <div v-if="visible" class="action-bar" data-action-bar data-testid="action-bar">
    <div class="action-buttons">
      <button
        v-for="btn in buttons"
        :key="btn.type"
        class="action-btn"
        :class="btn.className"
        :data-testid="`action-${btn.type}`"
        @click="onClick(btn.type)"
      >
        {{ btn.label }}
      </button>
    </div>
    <BetSlider
      v-if="raiseAction"
      v-model="raiseAmount"
      :min="raiseAction.minAmount"
      :max="raiseAction.maxAmount"
      :step="bigBlindStep"
      :pot="gameStore.totalPot"
    />
  </div>
</template>

<style scoped>
.action-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--casino-space-3);
  padding: var(--casino-space-3) var(--casino-space-4);
  background: rgba(0, 0, 0, 0.45);
  border-top: 1px solid rgba(245, 240, 225, 0.08);
}

.action-buttons {
  display: flex;
  gap: var(--casino-space-2);
  flex-wrap: wrap;
  justify-content: center;
}

.action-btn {
  min-width: 84px;
  padding: var(--casino-space-2) var(--casino-space-4);
  font-size: var(--casino-font-size-sm);
  font-weight: 700;
  color: var(--casino-card-white);
  border: none;
  border-radius: var(--casino-radius-md);
  cursor: pointer;
}

.action-fold {
  background: var(--casino-danger);
}

.action-check {
  background: rgba(245, 240, 225, 0.15);
  border: 1px solid rgba(245, 240, 225, 0.25);
}

.action-call {
  background: var(--casino-green-light);
}

.action-bet {
  background: var(--casino-green);
}

.action-raise {
  background: var(--casino-gold-deep);
}

.action-allin {
  background: var(--casino-gold);
  color: var(--casino-ink);
}
</style>
