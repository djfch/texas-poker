<script setup lang="ts">
/**
 * NicknameDialog.vue - Rename prompt mirroring the legacy profile modal:
 * prefilled with the current nickname, hard-capped at 20 chars by the
 * field (legacy input maxlength and the server-side slice(0, 20)).
 */
import { ref, watch } from 'vue'

const props = defineProps<{
  show: boolean
  /** Current nickname, used to prefill the field on open. */
  nickname: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  confirm: [nickname: string]
}>()

const name = ref('')

// Prefill with the current nickname each time the dialog opens.
watch(
  () => props.show,
  show => {
    if (show) name.value = props.nickname
  },
)

function onConfirm(): void {
  emit('confirm', name.value.trim())
  emit('update:show', false)
}
</script>

<template>
  <van-dialog
    :show="show"
    title="修改玩家名称"
    show-cancel-button
    confirm-button-text="保存"
    cancel-button-text="取消"
    data-testid="nickname-dialog"
    @update:show="emit('update:show', $event)"
    @confirm="onConfirm"
    @cancel="emit('update:show', false)"
  >
    <van-cell-group inset>
      <van-field
        v-model="name"
        placeholder="请输入新昵称"
        maxlength="20"
        data-testid="input-nickname"
        @keyup.enter="onConfirm"
      />
    </van-cell-group>
  </van-dialog>
</template>
