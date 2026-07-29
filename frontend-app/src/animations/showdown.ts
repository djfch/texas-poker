/**
 * animations/showdown.ts - Winner celebration and showdown card reveal.
 * Full tier: an expanding golden halo per winner plus a gentle float of
 * the seat card; simple tier keeps only the float (no glow particles).
 * The float animates .seat-inner because .table-seat uses a CSS translate
 * for centering that a GSAP y tween would override.
 */
import { gsap } from 'gsap'
import { centerIn, effectiveLevel, spawnFx } from './index'

/** Golden halo burst (full tier) + float loop for each winner seat. */
export function celebrateWinners(tableEl: HTMLElement, winnerSeatEls: HTMLElement[]): void {
  const full = effectiveLevel() === 'full'
  for (const seatEl of winnerSeatEls) {
    if (!(seatEl instanceof HTMLElement)) continue
    if (full) {
      const center = centerIn(seatEl, tableEl)
      const ring = spawnFx(tableEl, 'poker-anim-ring', center.x, center.y)
      gsap.fromTo(
        ring,
        { scale: 0.4, opacity: 0.9 },
        { scale: 2.4, opacity: 0, duration: 0.9, ease: 'power2.out', onComplete: () => ring.remove() },
      )
    }
    const inner = seatEl.querySelector('.seat-inner') ?? seatEl
    gsap.fromTo(
      inner,
      { y: 0 },
      {
        y: -8,
        duration: 0.22,
        yoyo: true,
        repeat: 3,
        ease: 'sine.inOut',
        onComplete: () => gsap.set(inner, { y: 0 }),
      },
    )
  }
}

/** Flip the revealed hole cards (.seat-cards .poker-card) face-up. */
export function revealShowdownCards(seatEl: HTMLElement | null): void {
  if (!seatEl) return
  const cards = seatEl.querySelectorAll('.seat-cards .poker-card')
  if (cards.length === 0) return
  cards.forEach((card, index) => {
    gsap.set(card, { transformPerspective: 600 })
    gsap.fromTo(
      card,
      { rotationY: 90, opacity: 0.4 },
      {
        rotationY: 0,
        opacity: 1,
        duration: 0.5,
        delay: index * 0.15,
        ease: 'power2.out',
        onComplete: () => gsap.set(card, { clearProps: 'transform,opacity' }),
      },
    )
  })
}
