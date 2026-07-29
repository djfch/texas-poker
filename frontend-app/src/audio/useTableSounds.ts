/**
 * audio/useTableSounds.ts - Wiring layer between the game store and the
 * synthesized sound engine. Called once from TableFelt; registers watchers
 * for the same store transitions the animation layer uses and plays the
 * matching effect. Sound is decorative: playSound already swallows audio
 * errors. Full-sync restores (restoreSeq bumped) are skipped so a reconnect
 * never replays a burst of sounds.
 *
 * Transition map (store -> sound):
 * - myHoleCards 0 -> 2 (game:dealt)          -> deal
 * - community 0->3 / 3->4 / 4->5             -> deal
 * - lastAction bet/call/raise                -> chip
 * - lastAction allin                         -> allin
 * - lastAction fold                          -> fold
 * - lastAction check                         -> check
 * - currentPosition becomes my seat          -> turn
 * - status -> ended and I am a winner        -> win
 */
import { watch } from 'vue'
import { useGameStore } from '@/stores/game'
import { playSound } from '@/audio/sound'

const CHIP_ACTIONS = new Set(['bet', 'call', 'raise'])

export function useTableSounds(): void {
  const gameStore = useGameStore()

  // ─── game:dealt (my hole cards arrive) ───────────────────────────
  watch(
    () => [gameStore.myHoleCards.length, gameStore.restoreSeq] as const,
    ([len, seq], [prevLen, prevSeq]) => {
      if (prevSeq === undefined || seq !== prevSeq) return
      if (len === 2 && prevLen !== 2) playSound('deal')
    },
  )

  // ─── game:community (street transitions only; skip full-sync) ────
  watch(
    () => [gameStore.communityCards.length, gameStore.restoreSeq] as const,
    ([len, seq], [prev, prevSeq]) => {
      if (prevSeq === undefined || seq !== prevSeq) return
      const advanced = (prev === 0 && len === 3) || (prev === 3 && len === 4) || (prev === 4 && len === 5)
      if (advanced) playSound('deal')
    },
  )

  // ─── game:action (chip / all-in / fold / check) ──────────────────
  watch(
    () => gameStore.lastAction,
    action => {
      if (!action) return
      if (action.type === 'allin') playSound('allin')
      else if (action.type === 'fold') playSound('fold')
      else if (action.type === 'check') playSound('check')
      else if (CHIP_ACTIONS.has(action.type)) playSound('chip')
    },
  )

  // ─── game:turn (only my own turn beeps) ──────────────────────────
  watch(
    () => gameStore.currentPosition,
    (position, prev) => {
      if (position === null || position === prev) return
      if (position === gameStore.mySeatPosition) playSound('turn')
    },
  )

  // ─── status -> ended: win jingle when I am among the winners ─────
  watch(
    () => [gameStore.status, gameStore.restoreSeq] as const,
    ([status, seq], [prevStatus, prevSeq]) => {
      // Skip the fresh/reconnect restore so an already-ended hand is silent.
      if (prevStatus === null || prevStatus === undefined || prevStatus === status) return
      if (prevSeq === undefined || seq !== prevSeq) return
      if (status !== 'ended') return
      const mySeat = gameStore.mySeatPosition
      if (mySeat === null) return
      if ((gameStore.winners ?? []).some(w => w.position === mySeat)) playSound('win')
    },
  )
}
