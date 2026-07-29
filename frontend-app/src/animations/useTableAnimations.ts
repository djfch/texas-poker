/**
 * animations/useTableAnimations.ts - Wiring layer between the game store
 * and the animation facade. Called once from TableFelt with the table
 * surface element; registers watchers for the store transitions and fires
 * the matching imperative animations. Every call is wrapped so an
 * animation failure can never break state rendering, and all tweens are
 * killed on unmount.
 *
 * Transition map (store -> animation):
 * - myHoleCards 0 -> 2 (game:dealt)          -> dealHoleCards
 * - community 0->3 / 3->4 / 4->5             -> revealCommunity(flop/turn/river)
 * - lastAction bet/call/raise/allin + amount -> flyBetToPot (+ allInImpact on allin)
 * - status -> showdown                       -> revealShowdownCards per revealed seat
 * - status -> ended                          -> celebrateWinners + distributePot
 * - currentPosition change (game:turn)       -> pulseActiveRing / stopPulse
 *
 * The hole-card / community watchers track the store's restoreSeq (bumped
 * by every game:state full sync): a card change arriving together with a
 * sync bump is an authoritative restore and must render without animation.
 * A plain null->status comparison cannot make this distinction, because a
 * live started -> dealt pair coalescing into one watcher flush shows the
 * same "status rose from null" shape as a restore.
 */
import { nextTick, onUnmounted, watch, type Ref } from 'vue'
import { useGameStore } from '@/stores/game'
import {
  allInImpact,
  celebrateWinners,
  dealHoleCards,
  distributePot,
  flyBetToPot,
  killTableFx,
  pulseActiveRing,
  revealCommunity,
  revealShowdownCards,
  stopPulse,
  type StreetName,
} from '@/animations/index'

const CHIP_ACTIONS = new Set(['bet', 'call', 'raise', 'allin'])

export function useTableAnimations(surfaceRef: Ref<HTMLElement | null>): void {
  const gameStore = useGameStore()

  function seatEl(position: number | null): HTMLElement | null {
    if (position === null || !surfaceRef.value) return null
    return surfaceRef.value.querySelector(`[data-seat-index="${position}"]`)
  }

  /** Animations are decorative: swallow every failure. */
  function safe(run: () => void): void {
    try {
      run()
    } catch {
      // Never let GSAP/DOM issues surface to the user interface.
    }
  }

  // ─── game:dealt (my hole cards arrive) ───────────────────────────
  watch(
    () => [gameStore.myHoleCards.length, gameStore.restoreSeq] as const,
    async ([len, seq], [prevLen, prevSeq]) => {
      // Full-sync restore (restoreSeq bumped): render without dealing.
      if (prevSeq === undefined || seq !== prevSeq) return
      if (len !== 2 || prevLen === 2) return
      await nextTick()
      safe(() => {
        const surface = surfaceRef.value
        if (!surface) return
        const me = gameStore.mySeatPosition
        const others = gameStore.players
          .filter(p => p.seatPosition !== me)
          .map(p => seatEl(p.seatPosition))
          .filter((el): el is HTMLElement => el !== null)
        dealHoleCards(surface, seatEl(me), others)
      })
    },
  )

  // ─── game:community (street transitions only; skips full-sync) ────
  watch(
    () => [gameStore.communityCards.length, gameStore.restoreSeq] as const,
    async ([len, seq], [prev, prevSeq]) => {
      // Full-sync restore (restoreSeq bumped): render without reveal.
      if (prevSeq === undefined || seq !== prevSeq) return
      const street: StreetName | null =
        prev === 0 && len === 3 ? 'flop' : prev === 3 && len === 4 ? 'turn' : prev === 4 && len === 5 ? 'river' : null
      if (!street) return
      await nextTick()
      safe(() => {
        if (surfaceRef.value) revealCommunity(surfaceRef.value, street, len - prev)
      })
    },
  )

  // ─── game:action (chip flight + all-in impact) ───────────────────
  watch(
    () => gameStore.lastAction,
    action => {
      if (!action) return
      safe(() => {
        const surface = surfaceRef.value
        if (!surface) return
        if (CHIP_ACTIONS.has(action.type) && action.amount > 0) {
          flyBetToPot(surface, seatEl(action.position), action.amount)
        }
        if (action.type === 'allin') allInImpact(surface)
      })
    },
  )

  // ─── status -> showdown / ended (skip full-sync restores) ────────
  watch(
    () => gameStore.status,
    async (status, prev) => {
      if (prev === null || prev === undefined || prev === status) return
      if (status === 'showdown') {
        await nextTick()
        safe(() => {
          for (const entry of gameStore.showdownResults) {
            revealShowdownCards(seatEl(entry.position))
          }
        })
        return
      }
      if (status === 'ended') {
        await nextTick()
        safe(() => {
          const surface = surfaceRef.value
          if (!surface) return
          const winnerEls = (gameStore.winners ?? [])
            .map(w => seatEl(w.position))
            .filter((el): el is HTMLElement => el !== null)
          if (winnerEls.length === 0) return
          celebrateWinners(surface, winnerEls)
          distributePot(surface, surface.querySelector('[data-pot]'), winnerEls)
        })
      }
    },
  )

  // ─── game:turn (acting seat ring pulse) ──────────────────────────
  watch(
    () => gameStore.currentPosition,
    (position, prev) => {
      safe(() => {
        if (prev !== null && prev !== undefined && prev !== position) stopPulse(seatEl(prev))
        if (position !== null) pulseActiveRing(seatEl(position))
      })
    },
  )

  onUnmounted(() => {
    safe(() => killTableFx(surfaceRef.value))
  })
}
