<script setup lang="ts">
/**
 * RoomView.vue - Waiting room: header, seat grid, action bar, settlement
 * panel. Interaction semantics replicate legacy frontend/js/views/room.js:
 * - join the room over the socket on mount (waiting for connect if needed)
 * - seat / ready / borrow / AI / start conditions follow the legacy updateUI
 * - room:settlement drives the leave settlement panel (borrow shows a toast)
 * - room:settled drives the room-closed settlement panel
 * - game:started (gameStore.gameId) navigates to the table view
 * All actions go through the typed socket service; state lives in stores.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import type { OccupiedSeatInfo, SeatInfo, Settlement } from '@/types'
import { usePlayerStore } from '@/stores/player'
import { useRoomStore } from '@/stores/room'
import { useGameStore } from '@/stores/game'
import {
  addAI,
  borrowChips,
  connect as connectSocket,
  isConnected,
  joinRoom as socketJoinRoom,
  leaveRoom as socketLeaveRoom,
  off as socketOff,
  on as socketOn,
  ready as socketReady,
  removeAI,
  setCurrentRoom,
  sit,
  stand,
  startGame,
} from '@/services/socket'
import RoomHeader from '@/components/room/RoomHeader.vue'
import SeatGrid from '@/components/room/SeatGrid.vue'
import RoomActions from '@/components/room/RoomActions.vue'
import SettlementDialog from '@/components/room/SettlementDialog.vue'

const route = useRoute()
const router = useRouter()
const playerStore = usePlayerStore()
const roomStore = useRoomStore()
const gameStore = useGameStore()

const roomId = computed(() => String(route.params.id))
const room = computed(() => roomStore.room)

// ─── Socket wiring ───────────────────────────────────────────────

function onConnectJoin(): void {
  socketJoinRoom(roomId.value)
}

onMounted(() => {
  // Record the intended room so stale room:state snapshots get dropped.
  roomStore.setCurrentRoomId(roomId.value)
  if (isConnected()) {
    socketJoinRoom(roomId.value)
  } else {
    // Direct entry (page refresh): start the connection, then join.
    connectSocket()
    socketOn('connect', onConnectJoin)
  }
  socketOn('error', onSocketError)
})

onUnmounted(() => {
  socketOff('connect', onConnectJoin)
  socketOff('error', onSocketError)
})

function onSocketError(data: unknown): void {
  const err = (data ?? {}) as { error?: string; message?: string }
  if (err.error === 'Room not found' || err.error === '房间不存在') {
    showToast('房间已关闭或不存在')
    roomStore.resetRoom()
    setTimeout(() => void router.push({ name: 'lobby' }), 1000)
    return
  }
  showToast(err.message || err.error || '出错了')
}

// ─── Seat / host computed state (legacy updateUI rules) ──────────

function isOccupied(seat: SeatInfo): seat is OccupiedSeatInfo {
  return seat.status === 'occupied'
}

const myPlayerId = computed(() => playerStore.playerId)

const mySeat = computed(() =>
  (room.value?.seats ?? []).find(
    (s): s is OccupiedSeatInfo => isOccupied(s) && s.playerId === myPlayerId.value,
  ),
)

const hostPlayer = computed(() =>
  room.value?.players.find(p => p.playerId === room.value?.hostId),
)

// Legacy: the host controls the room; when the host seat is an AI, any
// seated human takes over the controls.
const isHost = computed(
  () =>
    room.value !== null &&
    (room.value.hostId === myPlayerId.value || Boolean(mySeat.value && hostPlayer.value?.isAI)),
)

const isReady = computed(() => Boolean(mySeat.value?.isReady))
const seated = computed(() => mySeat.value !== undefined)
const myChips = computed(() => Number(mySeat.value?.chips) || 0)
const canBorrow = computed(
  () => seated.value && room.value?.status !== 'playing' && myChips.value <= 0,
)
const borrowTitle = computed(
  () => `每次借初始筹码 ¥${(room.value?.initialChips ?? 0).toLocaleString()}`,
)

const seatedCount = computed(() => room.value?.seatedCount ?? 0)
const showAddAI = computed(() => isHost.value && Boolean(room.value?.allowAI))
const canAddAI = computed(
  () =>
    showAddAI.value &&
    room.value !== null &&
    room.value.status !== 'playing' &&
    seatedCount.value < room.value.maxPlayers,
)
const addAITitle = computed(() => {
  if (canAddAI.value) return '添加一个AI玩家'
  return room.value && seatedCount.value >= room.value.maxPlayers ? '房间已满' : '当前不能添加AI'
})

const startState = computed(() => {
  if (!room.value) return { canStart: false, title: '' }
  const occupiedSeats = room.value.seats.filter(isOccupied)
  const allReady = occupiedSeats.every(s => s.isReady)
  const allFunded = occupiedSeats.every(s => (Number(s.chips) || 0) > 0)
  const canFillWithAI = room.value.allowAI && occupiedSeats.length >= 1
  const enoughPlayers = occupiedSeats.length >= 2 || canFillWithAI
  const canStart = allReady && enoughPlayers && allFunded

  let title = ''
  if (!canStart) {
    title = !allFunded ? '有玩家筹码为 0，需要先借筹码' : allReady ? '至少需要2名玩家' : '还有玩家未准备'
  } else if (canFillWithAI && occupiedSeats.length < 2) {
    title = '开始后将由 AI 补位'
  }
  return { canStart, title }
})

// ─── Actions ─────────────────────────────────────────────────────

function onToggleReady(): void {
  socketReady(!isReady.value)
}

function onLeave(): void {
  socketLeaveRoom()
}

// ─── Settlement / game-start watchers ────────────────────────────

const showSettlement = ref(false)
const settlementTitle = ref('离房结算')
const settlementList = ref<Settlement[]>([])

watch(
  () => roomStore.settlement,
  settlement => {
    if (!settlement) return
    if (roomStore.settlementType === 'borrow') {
      showToast(`已借筹码 ¥${(room.value?.initialChips ?? 0).toLocaleString()}`)
      roomStore.clearSettlement()
      return
    }
    settlementTitle.value = '离房结算'
    settlementList.value = [settlement]
    showSettlement.value = true
  },
)

watch(
  () => roomStore.roomSettled,
  data => {
    if (!data) return
    settlementTitle.value = '房间结算'
    settlementList.value = data.settlements
    showSettlement.value = true
  },
)

function onSettlementConfirm(): void {
  roomStore.resetRoom()
  gameStore.resetGame()
  setCurrentRoom(null)
  void router.push({ name: 'lobby' })
}

// game:started flips gameStore.gameId: jump to the table for this room.
watch(
  () => gameStore.gameId,
  id => {
    if (id) void router.push({ name: 'table', params: { id: roomId.value } })
  },
)
</script>

<template>
  <main class="room-view">
    <div v-if="room" class="room-container">
      <RoomHeader
        :name="room.name || '房间'"
        :room-id="room.id"
        :small-blind="room.smallBlind"
        :big-blind="room.bigBlind"
        :seated-count="seatedCount"
        :max-players="room.maxPlayers"
      />

      <SeatGrid
        :room="room"
        :my-player-id="myPlayerId"
        :is-host="isHost"
        @sit="sit"
        @removeAI="removeAI"
      />

      <RoomActions
        :seated="seated"
        :is-ready="isReady"
        :can-borrow="canBorrow"
        :borrow-title="borrowTitle"
        :show-add-a-i="showAddAI"
        :can-add-a-i="canAddAI"
        :add-a-i-title="addAITitle"
        :show-start="isHost"
        :can-start="startState.canStart"
        :start-title="startState.title"
        @toggleReady="onToggleReady"
        @stand="stand"
        @borrow="borrowChips"
        @addAI="addAI"
        @start="startGame"
        @leave="onLeave"
      />
    </div>

    <div v-else class="room-loading" data-testid="room-loading">加载房间中...</div>

    <SettlementDialog
      v-model:show="showSettlement"
      :title="settlementTitle"
      :settlements="settlementList"
      @confirm="onSettlementConfirm"
    />
  </main>
</template>

<style scoped>
.room-view {
  min-height: 100vh;
  padding: var(--casino-space-4) 0 var(--casino-space-6);
}

.room-container {
  max-width: 640px;
  margin: 0 auto;
  padding: 0 var(--casino-space-4);
}

.room-loading {
  padding: var(--casino-space-7) var(--casino-space-4);
  text-align: center;
  color: var(--casino-ivory-dim);
}

@media (min-width: 1024px) {
  .room-container {
    max-width: 760px;
  }
}
</style>
