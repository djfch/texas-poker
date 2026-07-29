/**
 * socket-dispatch.ts - Route inbound server events into the Pinia stores.
 *
 * Split from services/socket.ts to keep each file small. Imported only by
 * socket.ts; it depends on the stores, never the other way around, so the
 * import graph stays acyclic.
 */

import type { Socket } from 'socket.io-client'
import { WS_SERVER_EVENTS } from '@/types'
import type {
  ChatMessagePayload,
  ConnectedPayload,
  GameActionNotifyPayload,
  GameCommunityPayload,
  GameDealtPayload,
  GameEndedPayload,
  GamePotPayload,
  GameShowdownPayload,
  GameStartedPayload,
  GameStatePayload,
  GameTurnPayload,
  PlayerJoinedPayload,
  PlayerLeftPayload,
  PlayerReadyPayload,
  PlayerUpdatedPayload,
  RoomSettledPayload,
  RoomSettlementPayload,
  RoomStatePayload,
  ServerErrorPayload,
} from '@/types'
import { usePlayerStore } from '@/stores/player'
import { useRoomStore } from '@/stores/room'
import { useGameStore } from '@/stores/game'

/**
 * Hooks used for server 'error' events: local pub/sub fan-out plus the
 * PLAYER_UNKNOWN recovery that only the connection owner can perform.
 */
export interface DispatchHooks {
  emitLocal: (event: string, data: unknown) => void
  recoverExpiredSession: () => Promise<void>
}

/** Attach one store-bound handler per server event to the socket instance. */
export function attachServerEventDispatch(instance: Socket, hooks: DispatchHooks): void {
  const playerStore = usePlayerStore()
  const roomStore = useRoomStore()
  const gameStore = useGameStore()

  instance.on(WS_SERVER_EVENTS.CONNECTED, (data: ConnectedPayload) => {
    playerStore.handleConnected(data)
  })

  instance.on(WS_SERVER_EVENTS.ERROR, (data: ServerErrorPayload) => {
    if (data?.code === 'PLAYER_UNKNOWN') {
      hooks.emitLocal('session_expired', data)
      void hooks.recoverExpiredSession()
      return
    }
    hooks.emitLocal('error', data)
  })

  instance.on(WS_SERVER_EVENTS.ROOM_STATE, (data: RoomStatePayload) => {
    roomStore.applyRoomState(data.room)
  })
  instance.on(WS_SERVER_EVENTS.PLAYER_JOINED, (data: PlayerJoinedPayload) => {
    roomStore.applyPlayerJoined(data.seat)
  })
  instance.on(WS_SERVER_EVENTS.PLAYER_LEFT, (data: PlayerLeftPayload) => {
    roomStore.applyPlayerLeft(data.position)
  })
  instance.on(WS_SERVER_EVENTS.PLAYER_READY, (data: PlayerReadyPayload) => {
    roomStore.applyPlayerReady(data)
  })
  instance.on(WS_SERVER_EVENTS.PLAYER_UPDATED, (data: PlayerUpdatedPayload) => {
    playerStore.applyUpdatedPlayer(data.player)
    roomStore.applyPlayerUpdated(data)
  })
  instance.on(WS_SERVER_EVENTS.ROOM_SETTLEMENT, (data: RoomSettlementPayload) => {
    roomStore.applySettlement(data)
  })
  instance.on(WS_SERVER_EVENTS.ROOM_SETTLED, (data: RoomSettledPayload) => {
    roomStore.applyRoomSettled(data)
  })

  instance.on(WS_SERVER_EVENTS.GAME_STARTED, (data: GameStartedPayload) => {
    gameStore.handleGameStarted(data)
  })
  instance.on(WS_SERVER_EVENTS.GAME_DEALT, (data: GameDealtPayload) => {
    gameStore.handleGameDealt(data)
  })
  instance.on(WS_SERVER_EVENTS.GAME_COMMUNITY, (data: GameCommunityPayload) => {
    gameStore.handleGameCommunity(data)
  })
  instance.on(WS_SERVER_EVENTS.GAME_TURN, (data: GameTurnPayload) => {
    gameStore.handleGameTurn(data)
  })
  instance.on(WS_SERVER_EVENTS.GAME_ACTION, (data: GameActionNotifyPayload) => {
    gameStore.handleGameAction(data)
  })
  instance.on(WS_SERVER_EVENTS.GAME_POT, (data: GamePotPayload) => {
    gameStore.handleGamePot(data)
  })
  instance.on(WS_SERVER_EVENTS.GAME_SHOWDOWN, (data: GameShowdownPayload) => {
    gameStore.handleGameShowdown(data)
  })
  instance.on(WS_SERVER_EVENTS.GAME_ENDED, (data: GameEndedPayload) => {
    gameStore.handleGameEnded(data)
  })
  instance.on(WS_SERVER_EVENTS.GAME_STATE, (data: GameStatePayload) => {
    gameStore.handleGameState(data.gameState)
  })

  instance.on(WS_SERVER_EVENTS.CHAT_MESSAGE, (data: ChatMessagePayload) => {
    roomStore.appendChat(data)
  })
}
