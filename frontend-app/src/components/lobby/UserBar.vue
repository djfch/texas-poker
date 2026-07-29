<script setup lang="ts">
/**
 * UserBar.vue - Lobby identity bar: avatar circle plus nickname. Clicking
 * the nickname opens the rename dialog (legacy user-info click semantics).
 */
import { computed } from 'vue'

const props = defineProps<{
  /** Current nickname; falls back to 访客 when empty. */
  nickname: string
  /** Avatar color string (legacy stores a CSS color, not an image URL). */
  avatar: string
}>()

const emit = defineEmits<{
  edit: []
}>()

const initial = computed(() => (props.nickname || 'G').charAt(0).toUpperCase())
const avatarColor = computed(() => props.avatar || '#2ecc71')
</script>

<template>
  <div class="user-bar" data-testid="user-bar">
    <span class="user-avatar" :style="{ background: avatarColor }" data-testid="user-avatar">
      {{ initial }}
    </span>
    <button
      type="button"
      class="user-nickname"
      title="修改玩家名称"
      data-testid="user-nickname"
      @click="emit('edit')"
    >
      {{ nickname || '访客' }}
    </button>
  </div>
</template>

<style scoped>
.user-bar {
  display: flex;
  align-items: center;
  gap: var(--casino-space-2);
  padding-top: var(--casino-space-4);
}

.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--casino-ivory);
  font-size: var(--casino-font-size-sm);
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.user-nickname {
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--casino-ivory);
  font-size: var(--casino-font-size-md);
}

.user-nickname:hover {
  color: var(--casino-gold-light);
}
</style>
