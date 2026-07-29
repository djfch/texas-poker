<script setup lang="ts">
/**
 * PasswordDialog.vue - Prompt for the password of a private room,
 * mirroring the legacy modal-password flow.
 */
import { ref, watch } from 'vue'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  confirm: [password: string]
}>()

const password = ref('')

watch(
  () => props.show,
  show => {
    if (show) password.value = ''
  },
)

function onConfirm(): void {
  emit('confirm', password.value)
  emit('update:show', false)
}
</script>

<template>
  <van-dialog
    :show="show"
    title="输入房间密码"
    show-cancel-button
    confirm-button-text="加入"
    cancel-button-text="取消"
    data-testid="password-dialog"
    @update:show="emit('update:show', $event)"
    @confirm="onConfirm"
    @cancel="emit('update:show', false)"
  >
    <van-cell-group inset>
      <van-field
        v-model="password"
        type="password"
        placeholder="请输入密码"
        maxlength="20"
        data-testid="input-room-password"
        @keyup.enter="onConfirm"
      />
    </van-cell-group>
  </van-dialog>
</template>
