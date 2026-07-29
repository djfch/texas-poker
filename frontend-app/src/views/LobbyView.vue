<script setup lang="ts">
/**
 * LobbyView.vue - Lobby: hero, quick start, create room, public room list,
 * join by id. Interaction semantics replicate legacy frontend/js/views/lobby.js;
 * all data flows go through the lobby/player stores and services, never the
 * raw socket from this view (the only exception is establishing the socket
 * connection when the lobby mounts, per the startup wiring).
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { closeToast, showLoadingToast, showToast } from 'vant'
import type { RoomState } from '@/types'
import { useLobbyStore } from '@/stores/lobby'
import { usePlayerStore } from '@/stores/player'
import { connect as connectSocket, updateNickname } from '@/services/socket'
import LobbyHero from '@/components/lobby/LobbyHero.vue'
import UserBar from '@/components/lobby/UserBar.vue'
import RoomList from '@/components/lobby/RoomList.vue'
import JoinByIdBar from '@/components/lobby/JoinByIdBar.vue'
import CreateRoomDialog from '@/components/lobby/CreateRoomDialog.vue'
import PasswordDialog from '@/components/lobby/PasswordDialog.vue'
import NicknameDialog from '@/components/lobby/NicknameDialog.vue'
import type { CreateRoomConfig } from '@/types'

const router = useRouter()
const lobbyStore = useLobbyStore()
const playerStore = usePlayerStore()

const quickStarting = ref(false)
const showCreate = ref(false)
const creating = ref(false)
const showPassword = ref(false)
const pendingRoomId = ref<string | null>(null)
const showNickname = ref(false)

onMounted(() => {
  // The lobby is the app entry view: establish the socket connection here
  // (idempotent) and load the room list.
  connectSocket()
  void lobbyStore.loadRooms()
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

// Legacy behavior: auto-refresh the list when the tab becomes visible again.
function onVisibilityChange(): void {
  if (!document.hidden) void lobbyStore.loadRooms()
}

function navigateToRoom(roomId: string): void {
  void router.push({ name: 'room', params: { id: roomId } })
}

// ─── Quick start ─────────────────────────────────────────────────

function seatedCount(room: RoomState): number {
  return room.seatedCount || room.players.length
}

async function onQuickStart(): Promise<void> {
  quickStarting.value = true
  try {
    await lobbyStore.loadRooms()
    const target = lobbyStore.rooms.find(
      r => r.status === 'waiting' && seatedCount(r) < r.maxPlayers && !r.isPrivate,
    )

    if (target) {
      await doJoin(target.id)
      return
    }

    // No suitable room: auto-create a quick game room (legacy defaults).
    showLoadingToast({ message: '创建房间中...', forbidClick: true, duration: 0 })
    const room = await lobbyStore.createRoom({
      name: '快速游戏',
      maxPlayers: 6,
      smallBlind: 10,
      bigBlind: 20,
      initialChips: 1000,
      allowAI: true,
    })
    closeToast()
    if (room) {
      navigateToRoom(room.id)
      showToast('已创建快速游戏房间')
    } else {
      showToast(lobbyStore.error || '创建房间失败')
    }
  } finally {
    quickStarting.value = false
  }
}

// ─── Create room ─────────────────────────────────────────────────

async function onCreateSubmit(config: CreateRoomConfig): Promise<void> {
  creating.value = true
  showLoadingToast({ message: '创建房间中...', forbidClick: true, duration: 0 })
  try {
    const room = await lobbyStore.createRoom(config)
    if (!room) {
      showToast(lobbyStore.error || '创建房间失败')
      return
    }
    showCreate.value = false
    navigateToRoom(room.id)
    showToast(`房间 #${room.id} 创建成功！`)
  } finally {
    closeToast()
    creating.value = false
  }
}

// ─── Join room ───────────────────────────────────────────────────

function onJoinRoom(room: RoomState): void {
  if (room.isPrivate) {
    pendingRoomId.value = room.id
    showPassword.value = true
    return
  }
  void doJoin(room.id)
}

function onPasswordConfirm(password: string): void {
  if (pendingRoomId.value) {
    void doJoin(pendingRoomId.value, password)
  }
  pendingRoomId.value = null
}

async function doJoin(roomId: string, password?: string): Promise<void> {
  showLoadingToast({ message: '正在加入房间...', forbidClick: true, duration: 0 })
  try {
    const room = await lobbyStore.joinById(roomId, password)
    if (!room) {
      showToast(lobbyStore.error || '加入房间失败')
      return
    }
    navigateToRoom(room.id)
  } finally {
    closeToast()
  }
}

// ─── Rename ─────────────────────────────────────────────────────

function onNicknameConfirm(name: string): void {
  if (!name) {
    showToast('昵称不能为空')
    return
  }
  // Legacy semantics: an unchanged nickname closes silently.
  if (name === playerStore.nickname) return
  // The server acknowledges with player:updated, which refreshes the store.
  if (updateNickname(name)) {
    showToast('昵称修改成功')
  } else {
    showToast('修改失败，请检查网络连接')
  }
}
</script>

<template>
  <main class="lobby">
    <div class="lobby-container">
      <UserBar
        :nickname="playerStore.nickname"
        :avatar="playerStore.player?.avatar ?? ''"
        @edit="showNickname = true"
      />

      <LobbyHero
        :quick-starting="quickStarting"
        @quick-start="onQuickStart"
        @create="showCreate = true"
      />

      <RoomList
        :rooms="lobbyStore.rooms"
        :loading="lobbyStore.loading"
        :error="lobbyStore.error"
        @refresh="lobbyStore.loadRooms()"
        @join="onJoinRoom"
      />

      <JoinByIdBar @join="roomId => doJoin(roomId)" />
    </div>

    <CreateRoomDialog v-model:show="showCreate" :submitting="creating" @submit="onCreateSubmit" />
    <PasswordDialog v-model:show="showPassword" @confirm="onPasswordConfirm" />
    <NicknameDialog
      v-model:show="showNickname"
      :nickname="playerStore.nickname"
      @confirm="onNicknameConfirm"
    />
  </main>
</template>

<style scoped>
.lobby {
  min-height: 100vh;
  padding-bottom: var(--casino-space-6);
}

.lobby-container {
  max-width: 640px;
  margin: 0 auto;
  padding: 0 var(--casino-space-4);
}

@media (min-width: 1024px) {
  .lobby-container {
    max-width: 720px;
  }
}
</style>
