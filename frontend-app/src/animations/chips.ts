/**
 * animations/chips.ts - Chip flight animations for betting and payouts.
 * Bets fly from the acting seat (its data-seat-bet circle when present)
 * into the data-pot container while the pot number counts up; on hand end
 * the pot chips fly back out to the winner seats. The full tier adds a
 * golden glow and a floating amount label; simple keeps the plain flight.
 */
import { gsap } from 'gsap'
import { centerIn, effectiveLevel, spawnFx } from './index'

const CHIP_FLY_SECONDS = 0.5
const PAYOUT_CHIPS = 3

/** Pot value tweens keyed by element, so rapid bets never stack tweens. */
const potCountUps = new WeakMap<Element, gsap.core.Tween>()

function parseAmount(text: string): number {
  const digits = text.replace(/[^\d]/g, '')
  return digits ? Number(digits) : 0
}

/**
 * Count the displayed pot up by `amount`. Vue re-renders the authoritative
 * value when game:pot lands right after the action, so the transient text
 * is always corrected; no store state is touched here.
 */
function countUpPot(potEl: Element, amount: number): void {
  const valueEl = potEl.querySelector('.pot-value')
  if (!valueEl || amount <= 0) return
  potCountUps.get(valueEl)?.kill()
  const from = parseAmount(valueEl.textContent ?? '0')
  const state = { value: from }
  const tween = gsap.to(state, {
    value: from + amount,
    duration: CHIP_FLY_SECONDS,
    ease: 'power1.out',
    onUpdate: () => {
      valueEl.textContent = `¥${Math.round(state.value).toLocaleString()}`
    },
  })
  potCountUps.set(valueEl, tween)
}

/** Brief scale pulse on the pot pill once the chips land. */
function pulsePot(potEl: Element): void {
  const pill = potEl.querySelector('.pot-main') ?? potEl
  gsap.fromTo(pill, { scale: 1 }, { scale: 1.07, duration: 0.14, yoyo: true, repeat: 1 })
}

/** Fly one chip node between two points and remove it on landing. */
function flyChip(
  tableEl: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { delay?: number; glow: boolean; onLand?: () => void },
): void {
  const chip = spawnFx(tableEl, options.glow ? 'poker-anim-chip poker-anim-glow' : 'poker-anim-chip', from.x, from.y)
  gsap.to(chip, {
    x: to.x - from.x,
    y: to.y - from.y,
    duration: CHIP_FLY_SECONDS,
    delay: options.delay ?? 0,
    ease: 'power2.inOut',
    onComplete: () => {
      chip.remove()
      options.onLand?.()
    },
  })
}

/** Bet animation: chip (+ floating label on full tier) flies seat -> pot. */
export function flyBetToPot(tableEl: HTMLElement, seatEl: HTMLElement | null, amount: number): void {
  const pot = tableEl.querySelector('[data-pot]')
  if (!pot || !seatEl) return
  const full = effectiveLevel() === 'full'
  const anchor = seatEl.querySelector('[data-seat-bet]') ?? seatEl
  const from = centerIn(anchor, tableEl)
  const to = centerIn(pot, tableEl)
  flyChip(tableEl, from, to, { glow: full, onLand: () => pulsePot(pot) })
  if (full && amount > 0) {
    const label = spawnFx(tableEl, 'poker-anim-label', from.x, from.y)
    label.textContent = `+¥${amount.toLocaleString()}`
    gsap.to(label, {
      x: to.x - from.x,
      y: to.y - from.y - 12,
      opacity: 0,
      duration: 0.7,
      ease: 'power2.in',
      onComplete: () => label.remove(),
    })
  }
  countUpPot(pot, amount)
}

/** Payout animation: chips fly from the pot to every winner seat. */
export function distributePot(
  tableEl: HTMLElement,
  potEl: HTMLElement | null,
  winnerSeatEls: HTMLElement[],
): void {
  const pot = potEl ?? tableEl.querySelector('[data-pot]')
  if (!pot) return
  const seats = winnerSeatEls.filter((el): el is HTMLElement => el instanceof HTMLElement)
  if (seats.length === 0) return
  const full = effectiveLevel() === 'full'
  const from = centerIn(pot, tableEl)
  seats.forEach((seatEl, seatIndex) => {
    const to = centerIn(seatEl, tableEl)
    for (let i = 0; i < PAYOUT_CHIPS; i++) {
      flyChip(tableEl, from, to, { delay: seatIndex * 0.15 + i * 0.08, glow: full })
    }
  })
}
