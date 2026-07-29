<script setup lang="ts">
/**
 * SeatGrid.vue - Grid of seats for the waiting room, one slot per position
 * up to room.maxPlayers. Pure presentation; actions bubble up as events.
 */
import { computed } from 'vue'
import type { RoomState, SeatInfo } from '@/types'
import SeatCard from './SeatCard.vue'

const props = defineProps<{
  room: RoomState
  myPlayerId: string | null
  isHost: boolean
}>()

const emit = defineEmits<{
  sit: [position: number]
  removeAI: [position: number]
}>()

/** Seat for every position 0..maxPlayers-1, synthesizing empty slots. */
const seats = computed<SeatInfo[]>(() => {
  const list: SeatInfo[] = []
  for (let pos = 0; pos < props.room.maxPlayers; pos++) {
    list.push(props.room.seats[pos] ?? { position: pos, status: 'empty' })
  }
  return list
})

function isMe(seat: SeatInfo): boolean {
  return seat.status === 'occupied' && seat.playerId === props.myPlayerId
}

function canRemoveAI(seat: SeatInfo): boolean {
  return (
    props.isHost &&
    props.room.status !== 'playing' &&
    seat.status === 'occupied' &&
    seat.isAI
  )
}
</script>

<template>
  <div class="seats-grid" data-testid="seats-grid">
    <SeatCard
      v-for="seat in seats"
      :key="seat.position"
      :seat="seat"
      :is-me="isMe(seat)"
      :can-remove-a-i="canRemoveAI(seat)"
      @sit="emit('sit', $event)"
      @removeAI="emit('removeAI', $event)"
    />
  </div>
</template>

<style scoped>
.seats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--casino-space-3);
  margin-top: var(--casino-space-4);
}

@media (min-width: 1024px) {
  .seats-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
