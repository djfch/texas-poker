<script setup lang="ts">
/**
 * JoinByIdBar.vue - Join a room by its 6-character id.
 * Validation mirrors legacy onJoinById: required, uppercase A-Z0-9, length 6.
 */
import { ref } from 'vue'
import { showToast } from 'vant'

const emit = defineEmits<{
  join: [roomId: string]
}>()

const roomId = ref('')

function onJoin(): void {
  const id = roomId.value.trim().toUpperCase()
  if (!id) {
    showToast('请输入房间号')
    return
  }
  if (!/^[A-Z0-9]{6}$/.test(id)) {
    showToast('房间号必须为6位字母或数字')
    return
  }
  emit('join', id)
}
</script>

<template>
  <section class="join-section">
    <van-field
      v-model="roomId"
      class="join-input"
      placeholder="输入房间号（6位）"
      maxlength="6"
      data-testid="input-room-id"
      @keyup.enter="onJoin"
    />
    <van-button type="primary" data-testid="btn-join-by-id" @click="onJoin">加入房间</van-button>
  </section>
</template>

<style scoped>
.join-section {
  display: flex;
  gap: var(--casino-space-3);
  margin-top: var(--casino-space-5);
}

.join-input {
  flex: 1;
  border: 1px solid var(--casino-gold-deep);
  border-radius: var(--casino-radius-md);
  text-transform: uppercase;
}

.join-section .van-button {
  flex-shrink: 0;
}
</style>
