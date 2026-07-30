<script setup lang="ts">
/**
 * App.vue - Root component. Hosts the router view plus the global mid-hand
 * recovery watcher: when a room:state reports a playing room we belong to
 * while we are not on its table route (e.g. after a page refresh), navigate
 * back to the table. The in-room/seated guard keeps intentional lobby
 * visits and post-leave snapshots from bouncing the user back.
 */
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from '@/stores/player'
import { useRoomStore } from '@/stores/room'

const route = useRoute()
const router = useRouter()
const playerStore = usePlayerStore()
const roomStore = useRoomStore()

watch(
  () => roomStore.room,
  room => {
    if (!room || room.status !== 'playing') return
    if (route.name === 'table' && String(route.params.id) === room.id) return
    const myId = playerStore.playerId
    if (!myId) return
    const inRoom =
      room.players.some(p => p.playerId === myId) ||
      room.seats.some(s => s.status === 'occupied' && s.playerId === myId)
    if (!inRoom) return
    void router.push({ name: 'table', params: { id: room.id } })
  },
)
</script>

<template>
  <router-view />
</template>

<style>
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(ellipse at 50% 30%, rgba(30, 107, 79, 0.5), transparent 70%),
    var(--casino-felt-bg);
  color: var(--casino-ivory);
  font-family: var(--casino-font-body);
}

#app {
  min-height: 100vh;
}

/* ── Themed scrollbars (casino gold on translucent dark) ──────────
   Applied globally so every scrollable surface (drawers, overlays,
   lobby list, dialogs) matches the felt-and-gold theme. */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--casino-gold-deep) rgba(0, 0, 0, 0.25);
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.25);
  border-radius: var(--casino-radius-pill);
}

::-webkit-scrollbar-thumb {
  background: var(--casino-gold-deep);
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: var(--casino-radius-pill);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--casino-gold);
  border: 2px solid transparent;
  background-clip: padding-box;
}

::-webkit-scrollbar-corner {
  background: transparent;
}
</style>
