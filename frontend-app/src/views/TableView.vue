<script setup lang="ts">
/**
 * TableView.vue - Poker table view: top info bar, the felt, the bottom bar
 * (hole cards + chips) and the action bar. Semantics replicate legacy
 * frontend/js/views/table.js:
 * - on mount without game state, request the authoritative snapshot
 *   (game:request_state) for reconnect recovery (waiting for connect);
 * - actions go through the typed socket service; state lives in stores;
 * - room:settlement / room:settled drive the settlement flow, as RoomView.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import type { OccupiedSeatInfo, Settlement } from '@/types'
import { usePlayerStore } from '@/stores/player'
import { useRoomStore } from '@/stores/room'
import { useGameStore } from '@/stores/game'
import {
  connect as connectSocket,
  isConnected,
  leaveRoom as socketLeaveRoom,
  gameAction,
  off as socketOff,
  on as socketOn,
  ready as socketReady,
  borrowChips,
  requestGameState,
  setCurrentRoom,
  sit,
} from '@/services/socket'
import TableFelt from '@/components/table/TableFelt.vue'
import HoleCards from '@/components/table/HoleCards.vue'
import ActionBar from '@/components/table/ActionBar.vue'
import HistoryDrawer from '@/components/table/HistoryDrawer.vue'
import SettlementDialog from '@/components/room/SettlementDialog.vue'

const route = useRoute()
const router = useRouter()
const playerStore = usePlayerStore()
const roomStore = useRoomStore()
const gameStore = useGameStore()

const roomId = computed(() => String(route.params.id))
const room = computed(() => roomStore.room)

// ─── Reconnect recovery: ask for the snapshot when state is missing ──

let recoverTimer: ReturnType<typeof setTimeout> | null = null

function onConnectRecover(): void {
  requestGameState()
}

onMounted(() => {
  // Record the intended room so stale room:state snapshots get dropped.
  roomStore.setCurrentRoomId(roomId.value)
  if (isConnected()) {
    // Legacy waits 300ms so room:state lands before game:state.
    if (gameStore.status === null) {
      recoverTimer = setTimeout(() => requestGameState(), 300)
    }
  } else {
    connectSocket()
    socketOn('connect', onConnectRecover)
  }
  socketOn('error', onSocketError)
})

onUnmounted(() => {
  if (recoverTimer) clearTimeout(recoverTimer)
  socketOff('connect', onConnectRecover)
  socketOff('error', onSocketError)
})

function onSocketError(data: unknown): void {
  const err = (data ?? {}) as { error?: string; message?: string }
  showToast(err.message || err.error || '出错了')
}

// ─── Bottom bar state ──────────────────────────────────────────────

const myRoomSeat = computed(() =>
  (room.value?.seats ?? []).find(
    (s): s is OccupiedSeatInfo => s.status === 'occupied' && s.playerId === playerStore.playerId,
  ),
)

const myChips = computed(() => gameStore.me?.chips ?? myRoomSeat.value?.chips ?? 0)
const myNickname = computed(
  () => myRoomSeat.value?.nickname || gameStore.me?.nickname || playerStore.nickname || '我',
)

// ─── Actions (all through the typed socket service) ────────────────

function onAction(type: string, amount?: number): void {
  gameAction(type as Parameters<typeof gameAction>[0], amount)
}

function onSit(position: number): void {
  sit(position)
}

/** Legacy onNextHandAction: broke players borrow, others toggle ready. */
function onNextHand(): void {
  const seat = myRoomSeat.value
  if (!seat) return
  if ((Number(seat.chips) || 0) <= 0) {
    borrowChips()
  } else if (!seat.isReady) {
    socketReady(true)
  }
}

function onLeave(): void {
  if (!roomStore.room) {
    void router.push({ name: 'lobby' })
    return
  }
  socketLeaveRoom()
}

// ─── Settlement flow (same as RoomView) ────────────────────────────

const showSettlement = ref(false)
const settlementTitle = ref('离房结算')
const settlementList = ref<Settlement[]>([])
const showHistory = ref(false)

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
</script>

<template>
  <main class="table-view">
    <header class="table-header">
      <van-button size="small" plain type="danger" data-testid="btn-table-leave" @click="onLeave">
        离开
      </van-button>
      <div class="table-room-info">
        <span class="room-name">{{ room?.name || '房间' }}</span>
        <span class="room-id">#{{ roomId }}</span>
        <span class="room-blinds">盲注: {{ room?.smallBlind ?? '-' }}/{{ room?.bigBlind ?? '-' }}</span>
      </div>
      <van-button size="small" plain data-testid="btn-history" @click="showHistory = true">
        记录
      </van-button>
    </header>

    <TableFelt @sit="onSit" @next-hand="onNextHand" />

    <footer class="player-bar">
      <div class="my-hole-cards" data-my-hole-cards>
        <HoleCards :cards="gameStore.myHoleCards" />
      </div>
      <div class="my-info">
        <span class="my-nickname">{{ myNickname }}</span>
        <span class="my-chips">¥{{ myChips.toLocaleString() }}</span>
      </div>
    </footer>

    <ActionBar @action="onAction" />

    <HistoryDrawer v-model:show="showHistory" />

    <SettlementDialog
      v-model:show="showSettlement"
      :title="settlementTitle"
      :settlements="settlementList"
      @confirm="onSettlementConfirm"
    />
  </main>
</template>

<style scoped>
.table-view {
  display: flex;
  flex-direction: column;
  /* Positioned so deal-animation nodes (spawned at this root) anchor here
     and can fly from the felt deck down to the bottom hole-cards. */
  position: relative;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--casino-space-3);
  padding: var(--casino-space-2) var(--casino-space-4);
  padding-top: calc(var(--casino-space-2) + env(safe-area-inset-top));
  background: rgba(0, 0, 0, 0.25);
  border-bottom: 1px solid rgba(245, 240, 225, 0.06);
  flex-shrink: 0;
}

.table-room-info {
  display: flex;
  align-items: center;
  gap: var(--casino-space-3);
  font-size: var(--casino-font-size-xs);
  flex-wrap: wrap;
}

.room-name {
  font-size: var(--casino-font-size-sm);
  font-weight: 600;
  color: var(--casino-ivory);
}

.room-id {
  color: var(--casino-ivory-dim);
}

.room-blinds {
  color: var(--casino-gold-light);
  font-weight: 600;
}

.player-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--casino-space-4);
  padding: var(--casino-space-2) var(--casino-space-4);
  padding-bottom: calc(var(--casino-space-2) + env(safe-area-inset-bottom));
  background: rgba(0, 0, 0, 0.4);
  border-top: 1px solid rgba(245, 240, 225, 0.06);
  flex-shrink: 0;
}

.my-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.my-nickname {
  font-size: var(--casino-font-size-sm);
  font-weight: 600;
  color: var(--casino-ivory);
}

.my-chips {
  font-size: var(--casino-font-size-md);
  font-weight: 700;
  color: var(--casino-gold-light);
}

@media (min-width: 1024px) {
  .table-header {
    padding: var(--casino-space-3) var(--casino-space-5);
  }

  .player-bar {
    padding: var(--casino-space-3) var(--casino-space-6)
      calc(var(--casino-space-3) + env(safe-area-inset-bottom));
  }
}
</style>
