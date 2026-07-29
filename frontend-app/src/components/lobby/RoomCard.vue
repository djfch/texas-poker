<script setup lang="ts">
/**
 * RoomCard.vue - One public room in the lobby list.
 * Shows name, id, blinds, occupancy and status; the whole card (or its join
 * button) emits `join`. Full / playing rooms are not joinable, matching the
 * legacy lobby.js disabled-button semantics.
 */
import { computed } from 'vue'
import type { RoomState } from '@/types'

const props = defineProps<{
  room: RoomState
}>()

const emit = defineEmits<{
  join: [room: RoomState]
}>()

const isPlaying = computed(() => props.room.status === 'playing')
const seated = computed(() => props.room.seatedCount || props.room.players.length)
const isFull = computed(() => seated.value >= props.room.maxPlayers)
const joinable = computed(() => !isFull.value && !isPlaying.value)

const joinLabel = computed(() => {
  if (isFull.value) return '已满'
  if (isPlaying.value) return '游戏中'
  return '加入'
})

function onJoin(): void {
  if (joinable.value) emit('join', props.room)
}
</script>

<template>
  <article class="room-card" :data-testid="`room-card-${room.id}`" @click="onJoin">
    <div class="room-card-main">
      <div class="room-card-title">
        <span class="room-name">{{ room.name }}</span>
        <span class="room-id">#{{ room.id }}</span>
        <span v-if="room.isPrivate" class="room-lock" title="密码房间">🔒</span>
      </div>
      <div class="room-card-details">
        <span class="detail">{{ seated }}/{{ room.maxPlayers }} 人</span>
        <span class="detail">盲注 {{ room.smallBlind }}/{{ room.bigBlind }}</span>
        <span class="room-status" :class="isPlaying ? 'status-playing' : 'status-waiting'">
          {{ isPlaying ? '游戏中' : '等待中' }}
        </span>
      </div>
    </div>
    <van-button
      size="small"
      type="primary"
      :disabled="!joinable"
      :data-testid="`btn-join-${room.id}`"
      @click.stop="onJoin"
    >
      {{ joinLabel }}
    </van-button>
  </article>
</template>

<style scoped>
.room-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--casino-space-3);
  padding: var(--casino-space-3) var(--casino-space-4);
  background: var(--casino-green-deep);
  border: 1px solid var(--casino-gold-deep);
  border-radius: var(--casino-radius-md);
  box-shadow: var(--casino-shadow-sm);
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.room-card:hover {
  border-color: var(--casino-gold);
}

.room-card-main {
  min-width: 0;
}

.room-card-title {
  display: flex;
  align-items: baseline;
  gap: var(--casino-space-2);
}

.room-name {
  color: var(--casino-ivory);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 10em;
}

.room-id {
  color: var(--casino-gold-deep);
  font-size: var(--casino-font-size-xs);
  letter-spacing: 1px;
}

.room-lock {
  font-size: var(--casino-font-size-xs);
}

.room-card-details {
  display: flex;
  gap: var(--casino-space-3);
  margin-top: var(--casino-space-1);
  font-size: var(--casino-font-size-xs);
  color: var(--casino-ivory-dim);
}

.room-status.status-waiting {
  color: var(--casino-gold-light);
}

.room-status.status-playing {
  color: var(--casino-danger);
}
</style>
