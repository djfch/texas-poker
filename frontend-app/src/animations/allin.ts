/**
 * animations/allin.ts - All-in impact: a red-gold flash washes over the
 * felt; the full tier adds a short screen shake. The simple tier drops
 * the shake per the degradation ladder (no shake / no particles).
 * The flash is an opacity-only overlay; the shake is transform-only.
 */
import { gsap } from 'gsap'
import { effectiveLevel, spawnFx } from './index'

const SHAKE_PIXELS = 5

export function allInImpact(tableEl: HTMLElement): void {
  const flash = spawnFx(tableEl, 'poker-anim-flash', 0, 0)
  gsap.fromTo(
    flash,
    { opacity: 0 },
    { opacity: 1, duration: 0.12, yoyo: true, repeat: 1, ease: 'power1.inOut', onComplete: () => flash.remove() },
  )
  if (effectiveLevel() !== 'full') return
  gsap.fromTo(
    tableEl,
    { x: 0 },
    {
      x: SHAKE_PIXELS,
      duration: 0.05,
      yoyo: true,
      repeat: 5,
      ease: 'none',
      onComplete: () => gsap.set(tableEl, { x: 0 }),
    },
  )
}
