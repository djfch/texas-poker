<script setup lang="ts">
/**
 * RoomActions.vue - Action bar of the waiting room. Button visibility and
 * disabled rules replicate the legacy room.js updateUI logic:
 * - ready toggle / stand: only when I am seated (ready disabled while broke)
 * - borrow: only when I am seated with 0 chips while the room is waiting
 * - add AI: host only, when the room allows AI (disabled when full/playing)
 * - start: host only, enabled when everyone is ready and funded and there
 *   are enough players (AI fill counts when allowed)
 * - leave: always visible
 *
 * Every click goes in-flight: the buttons stay disabled until the next
 * room:state snapshot lands (the server answer), so double clicks cannot
 * double-emit.
 */
import { ref, watch } from 'vue'
import { useRoomStore } from '@/stores/room'

defineProps<{
  seated: boolean
  isReady: boolean
  canBorrow: boolean
  borrowTitle: string
  showAddAI: boolean
  canAddAI: boolean
  addAITitle: string
  showStart: boolean
  canStart: boolean
  startTitle: string
}>()

const emit = defineEmits<{
  toggleReady: []
  stand: []
  borrow: []
  addAI: []
  start: []
  leave: []
}>()

type RoomAction = 'toggleReady' | 'stand' | 'borrow' | 'addAI' | 'start' | 'leave'

const roomStore = useRoomStore()

/** One click in flight until the authoritative room:state arrives. */
const inFlight = ref(false)

watch(
  () => roomStore.room,
  () => {
    inFlight.value = false
  },
)

// Typed emit() is overloaded per event, so a union-typed name cannot be
// emitted directly; dispatch through per-event thunks instead.
const EMITTERS: Record<RoomAction, () => void> = {
  toggleReady: () => emit('toggleReady'),
  stand: () => emit('stand'),
  borrow: () => emit('borrow'),
  addAI: () => emit('addAI'),
  start: () => emit('start'),
  leave: () => emit('leave'),
}

function act(action: RoomAction): void {
  if (inFlight.value) return
  inFlight.value = true
  EMITTERS[action]()
}
</script>

<template>
  <div class="room-actions" data-testid="room-actions">
    <van-button
      v-if="seated"
      :type="isReady ? 'warning' : 'primary'"
      :disabled="canBorrow || inFlight"
      :title="canBorrow ? '筹码为 0，请先借筹码' : ''"
      data-testid="btn-room-ready"
      @click="act('toggleReady')"
    >
      {{ isReady ? '取消准备' : '准备' }}
    </van-button>

    <van-button v-if="seated" :disabled="inFlight" data-testid="btn-room-stand" @click="act('stand')">
      站起
    </van-button>

    <van-button
      v-if="canBorrow"
      type="primary"
      plain
      :disabled="inFlight"
      :title="borrowTitle"
      data-testid="btn-room-borrow"
      @click="act('borrow')"
    >
      借码
    </van-button>

    <van-button
      v-if="showAddAI"
      :disabled="!canAddAI || inFlight"
      :title="addAITitle"
      data-testid="btn-room-add-ai"
      @click="act('addAI')"
    >
      加 AI
    </van-button>

    <van-button
      v-if="showStart"
      type="primary"
      :disabled="!canStart || inFlight"
      :title="startTitle"
      data-testid="btn-room-start"
      @click="act('start')"
    >
      开始游戏
    </van-button>

    <van-button type="danger" plain :disabled="inFlight" data-testid="btn-room-leave" @click="act('leave')">
      离开房间
    </van-button>
  </div>
</template>

<style scoped>
.room-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--casino-space-3);
  justify-content: center;
  margin-top: var(--casino-space-5);
}
</style>
