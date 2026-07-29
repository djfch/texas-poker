import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Vant from 'vant'
import App from './App.vue'
import router from './router'
import { usePlayerStore } from './stores/player'
import { initAudioUnlock } from './audio/sound'

import 'vant/lib/index.css'
import './styles/tokens.css'
import './styles/vant-theme.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(Vant)

// Restore the persisted guest identity before mounting so the REST layer
// carries the x-player-id header from the very first request. The socket
// connection itself is established when the lobby view mounts.
usePlayerStore().restore()

// Sound is always on; browsers require a user gesture before audio can
// play, so arm the one-time AudioContext unlock on the first interaction.
initAudioUnlock()

app.mount('#app')
