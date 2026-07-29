<script setup lang="ts">
/**
 * RoomList.vue - Public room section of the lobby: header with refresh,
 * plus loading / error / empty states and the room cards.
 * State texts mirror the legacy lobby.js renderRoomList messages.
 */
import type { RoomState } from '@/types'
import RoomCard from './RoomCard.vue'

defineProps<{
  rooms: RoomState[]
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  refresh: []
  join: [room: RoomState]
}>()
</script>

<template>
  <section class="room-section">
    <header class="section-header">
      <h2 class="section-title">公开房间</h2>
      <van-button
        size="small"
        icon="replay"
        :loading="loading"
        data-testid="btn-refresh-rooms"
        @click="emit('refresh')"
      >
        刷新
      </van-button>
    </header>

    <div v-if="loading" class="room-list-state" data-testid="room-list-loading">
      加载房间中...
    </div>
    <div v-else-if="error" class="room-list-state" data-testid="room-list-error">
      加载房间失败
    </div>
    <div v-else-if="rooms.length === 0" class="room-list-state" data-testid="room-list-empty">
      <p>暂无公开房间</p>
      <p class="state-muted">创建一个开始游戏吧！</p>
    </div>

    <div v-else class="room-list" data-testid="room-list">
      <RoomCard
        v-for="room in rooms"
        :key="room.id"
        :room="room"
        @join="emit('join', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.room-section {
  margin-top: var(--casino-space-5);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--casino-space-3);
}

.section-title {
  margin: 0;
  font-family: var(--casino-font-title);
  font-size: var(--casino-font-size-lg);
  color: var(--casino-gold);
  letter-spacing: 2px;
}

.room-list {
  display: flex;
  flex-direction: column;
  gap: var(--casino-space-3);
}

.room-list-state {
  padding: var(--casino-space-6) var(--casino-space-4);
  text-align: center;
  color: var(--casino-ivory-dim);
  border: 1px dashed var(--casino-gold-deep);
  border-radius: var(--casino-radius-md);
}

.room-list-state p {
  margin: 0;
}

.state-muted {
  margin-top: var(--casino-space-2) !important;
  font-size: var(--casino-font-size-xs);
  color: var(--casino-gold-deep);
}
</style>
