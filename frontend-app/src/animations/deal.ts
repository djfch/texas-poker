/**
 * animations/deal.ts - Card dealing and community reveal animations.
 * Cards fly as spawned back-side nodes from the data-deck marker to each
 * target; the viewer's own cards flip face-up on arrival. `mySeatEl` is the
 * viewer's landing element (the bottom hole-cards area, so the flip lands
 * where the real cards live), while opponents land on their felt seats.
 * Community streets flip in place with a stagger (flop) or as a single
 * card (turn/river). Movement-only, so both full and simple tiers run the
 * same motion.
 */
import { gsap } from 'gsap'
import { centerIn, spawnFx } from './index'

export type StreetName = 'flop' | 'turn' | 'river'

const CARDS_PER_SEAT = 2
const FLY_SECONDS = 0.45
const STAGGER_SECONDS = 0.12

/** Fly two card backs to one seat; the viewer's cards flip face-up. */
function flyCardsToSeat(
  tableEl: HTMLElement,
  from: { x: number; y: number },
  seatEl: HTMLElement,
  isMe: boolean,
  index: number,
): void {
  const to = centerIn(seatEl, tableEl)
  for (let i = 0; i < CARDS_PER_SEAT; i++) {
    const card = spawnFx(tableEl, 'poker-anim-card', from.x, from.y)
    const delay = (index * CARDS_PER_SEAT + i) * STAGGER_SECONDS
    const tl = gsap.timeline({ delay, onComplete: () => card.remove() })
    tl.to(card, { x: to.x - from.x, y: to.y - from.y, duration: FLY_SECONDS, ease: 'power2.out' })
    if (isMe) {
      // Flip: edge-on, swap to the face style, then settle and fade out.
      tl.to(card, { rotationY: 90, duration: 0.12, ease: 'power1.in' })
      tl.call(() => card.classList.add('poker-anim-card-face'))
      tl.to(card, { rotationY: 0, duration: 0.16, ease: 'power1.out' })
      tl.to(card, { opacity: 0, duration: 0.25 }, '+=0.15')
    } else {
      tl.to(card, { opacity: 0, duration: 0.2 }, '+=0.1')
    }
  }
}

/**
 * Deal hole cards from the deck marker to every occupied seat. Opponents
 * receive face-down backs; the viewer's own seat gets a flip reveal.
 */
export function dealHoleCards(
  tableEl: HTMLElement,
  mySeatEl: HTMLElement | null,
  otherSeatEls: HTMLElement[],
): void {
  const deck = tableEl.querySelector('[data-deck]')
  if (!deck) return
  const from = centerIn(deck, tableEl)
  const seats: Array<{ el: HTMLElement; isMe: boolean }> = otherSeatEls
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .map(el => ({ el, isMe: false }))
  if (mySeatEl) seats.push({ el: mySeatEl, isMe: true })
  seats.forEach((seat, index) => flyCardsToSeat(tableEl, from, seat.el, seat.isMe, index))
}

/**
 * Flip newly dealt community cards in place. Slots are located via
 * data-community-index: flop = 0..2, turn = 3, river = 4.
 */
export function revealCommunity(tableEl: HTMLElement, street: StreetName, count: number): void {
  const startIndex = street === 'flop' ? 0 : street === 'turn' ? 3 : 4
  for (let i = startIndex; i < startIndex + count; i++) {
    const slot = tableEl.querySelector(`[data-community-index="${i}"]`)
    const card = slot?.querySelector('.poker-card') ?? slot
    if (!card) continue
    gsap.set(card, { transformPerspective: 600 })
    gsap.fromTo(
      card,
      { rotationY: -90, opacity: 0.3, y: -12 },
      {
        rotationY: 0,
        opacity: 1,
        y: 0,
        duration: 0.55,
        delay: (i - startIndex) * 0.16,
        ease: 'back.out(1.4)',
        onComplete: () => gsap.set(card, { clearProps: 'transform,opacity' }),
      },
    )
  }
}
