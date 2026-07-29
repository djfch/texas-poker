<script setup lang="ts">
/**
 * CreateRoomDialog.vue - Create-room form inside a Vant dialog.
 * Fields per spec: room name, blind tier, max players, optional password.
 * Initial chips and AI permission keep the legacy defaults (1000 / allowed).
 */
import { reactive, watch } from 'vue'
import type { CreateRoomConfig } from '@/types'

/** Blind tiers guarantee bigBlind === 2 * smallBlind (legacy validation rule). */
const BLIND_TIERS = [
  { label: '10/20', smallBlind: 10, bigBlind: 20 },
  { label: '25/50', smallBlind: 25, bigBlind: 50 },
  { label: '50/100', smallBlind: 50, bigBlind: 100 },
  { label: '100/200', smallBlind: 100, bigBlind: 200 },
] as const

const DEFAULT_CHIPS = 1000

const props = defineProps<{
  show: boolean
  submitting: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  submit: [config: CreateRoomConfig]
}>()

const form = reactive({
  name: '德州房间',
  tier: 0,
  maxPlayers: 6,
  password: '',
})

// Reset the form to defaults each time the dialog opens.
watch(
  () => props.show,
  show => {
    if (show) {
      form.name = '德州房间'
      form.tier = 0
      form.maxPlayers = 6
      form.password = ''
    }
  },
)

function close(): void {
  emit('update:show', false)
}

function onConfirm(): void {
  const tier = BLIND_TIERS[form.tier] ?? BLIND_TIERS[0]
  const password = form.password.trim()
  emit('submit', {
    name: form.name.trim() || '德州房间',
    maxPlayers: form.maxPlayers,
    smallBlind: tier.smallBlind,
    bigBlind: tier.bigBlind,
    initialChips: DEFAULT_CHIPS,
    allowAI: true,
    ...(password ? { password, isPrivate: true } : {}),
  })
}
</script>

<template>
  <van-dialog
    :show="show"
    title="创建房间"
    show-cancel-button
    confirm-button-text="创建"
    cancel-button-text="取消"
    :confirm-button-disabled="submitting"
    data-testid="create-room-dialog"
    @update:show="emit('update:show', $event)"
    @confirm="onConfirm"
    @cancel="close"
  >
    <van-cell-group inset>
      <van-field
        v-model="form.name"
        label="房间名称"
        placeholder="德州房间"
        maxlength="20"
        data-testid="create-room-name"
      />
      <van-field label="盲注档" class="tier-field">
        <template #input>
          <van-radio-group v-model="form.tier" direction="horizontal" data-testid="create-room-tiers">
            <van-radio v-for="(tier, i) in BLIND_TIERS" :key="tier.label" :name="i">
              {{ tier.label }}
            </van-radio>
          </van-radio-group>
        </template>
      </van-field>
      <van-field label="人数上限">
        <template #input>
          <van-stepper v-model="form.maxPlayers" min="2" max="9" data-testid="create-room-max" />
        </template>
      </van-field>
      <van-field
        v-model="form.password"
        type="password"
        label="密码"
        placeholder="留空为公开房间"
        maxlength="20"
        data-testid="create-room-password"
      />
    </van-cell-group>
  </van-dialog>
</template>

<style scoped>
.tier-field :deep(.van-radio) {
  margin-bottom: var(--casino-space-2);
}
</style>
