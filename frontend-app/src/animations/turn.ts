/**
 * animations/turn.ts - Breathing pulse on the acting seat's .seat-ring.
 * The ring already gets its gold border from CSS; this only loops a soft
 * scale/opacity breathing on top. Cheap transform/opacity work, so the
 * pulse runs in both full and simple tiers. Tweens are tracked per seat
 * so stopPulse / stopAllPulses can kill them deterministically.
 */
import { gsap } from 'gsap'

const activePulses = new Map<HTMLElement, gsap.core.Tween>()

function findRing(seatEl: HTMLElement | null): Element | null {
  return seatEl?.querySelector('.seat-ring') ?? null
}

/** Start (or restart) the breathing pulse on a seat's ring. */
export function pulseActiveRing(seatEl: HTMLElement | null): void {
  const ring = findRing(seatEl)
  if (!ring || !seatEl) return
  stopPulse(seatEl)
  gsap.set(ring, { scale: 1, opacity: 1 })
  const tween = gsap.to(ring, {
    scale: 1.08,
    opacity: 0.5,
    duration: 0.7,
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut',
  })
  activePulses.set(seatEl, tween)
}

/** Stop the pulse for one seat and restore the ring's resting state. */
export function stopPulse(seatEl: HTMLElement | null): void {
  if (!seatEl) return
  activePulses.get(seatEl)?.kill()
  activePulses.delete(seatEl)
  const ring = findRing(seatEl)
  if (ring) gsap.set(ring, { scale: 1, opacity: 1 })
}

/** Kill every running pulse (component unmount / leaving the table). */
export function stopAllPulses(): void {
  for (const [seatEl, tween] of activePulses) {
    tween.kill()
    const ring = findRing(seatEl)
    if (ring) gsap.set(ring, { scale: 1, opacity: 1 })
  }
  activePulses.clear()
}
