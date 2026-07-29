<script setup lang="ts">
/**
 * RoomHeader.vue - Room title bar: name, copyable room id, blinds, occupancy.
 */
import { showToast } from 'vant'

const props = defineProps<{
  name: string
  roomId: string
  smallBlind: number
  bigBlind: number
  seatedCount: number
  maxPlayers: number
}>()

async function copyRoomId(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.roomId)
    showToast('房间号已复制')
  } catch {
    showToast(`房间号: ${props.roomId}`)
  }
}
</script>

<template>
  <header class="room-header">
    <h2 class="room-name">{{ name }}</h2>
    <div class="room-meta">
      <button class="room-id" type="button" title="点击复制房间号" data-testid="room-id" @click="copyRoomId">
        房间号: {{ roomId }} 📋
      </button>
      <span class="meta-item">盲注: {{ smallBlind }}/{{ bigBlind }}</span>
      <span class="meta-item">{{ seatedCount }}/{{ maxPlayers }} 人</span>
    </div>
  </header>
</template>

<style scoped>
.room-header {
  padding: var(--casino-space-4);
  background: var(--casino-green-deep);
  border: 1px solid var(--casino-gold-deep);
  border-radius: var(--casino-radius-md);
  box-shadow: var(--casino-shadow-sm);
}

.room-name {
  margin: 0 0 var(--casino-space-2);
  font-family: var(--casino-font-title);
  font-size: var(--casino-font-size-lg);
  color: var(--casino-gold);
  letter-spacing: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--casino-space-3);
  font-size: var(--casino-font-size-sm);
  color: var(--casino-ivory-dim);
}

.room-id {
  padding: 0;
  border: none;
  background: none;
  color: var(--casino-gold-light);
  font-size: var(--casino-font-size-sm);
  cursor: pointer;
}
</style>
