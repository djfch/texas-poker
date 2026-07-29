/**
 * animations/index.ts - Facade of the table animation system plus the
 * three-tier quality ladder (full | simple | off).
 *
 * Tier resolution (pure, unit-tested):
 * - mode 'off' (localStorage poker_animations)  -> everything is a no-op
 * - mode 'on'                                   -> always full (user override)
 * - mode 'auto' (default): prefers-reduced-motion -> off;
 *   low-end device (hardwareConcurrency <= 4 or deviceMemory <= 4) -> simple;
 *   otherwise full.
 * The simple tier keeps translate/fade motion but drops particles, glow
 * and screen shake.
 *
 * All public APIs are re-exported here behind an off-guard so callers never
 * branch on the tier themselves. Animations are decorative only: every API
 * silently degrades when its target elements are missing.
 */
import { gsap } from 'gsap'
import { dealHoleCards as dealHoleCardsImpl, revealCommunity as revealCommunityImpl } from './deal'
import { flyBetToPot as flyBetToPotImpl, distributePot as distributePotImpl } from './chips'
import { pulseActiveRing as pulseImpl, stopPulse as stopPulseImpl, stopAllPulses } from './turn'
import { celebrateWinners as celebrateImpl, revealShowdownCards as revealCardsImpl } from './showdown'
import { allInImpact as allInImpactImpl } from './allin'
import type { StreetName } from './deal'

export type { StreetName } from './deal'

// ─── Tier management ───────────────────────────────────────────────

export type AnimationMode = 'auto' | 'on' | 'off'
export type AnimationLevel = 'full' | 'simple' | 'off'

export const ANIMATION_STORAGE_KEY = 'poker_animations'

/** Environment signals relevant for the auto tier. */
export interface MotionEnv {
  reducedMotion: boolean
  cores: number
  /** navigator.deviceMemory in GB; null when the browser does not report it. */
  memoryGB: number | null
}

/** Pure tier resolution, kept separate from browser APIs for unit tests. */
export function resolveLevel(mode: AnimationMode, env: MotionEnv): AnimationLevel {
  if (mode === 'off') return 'off'
  if (mode === 'on') return 'full'
  if (env.reducedMotion) return 'off'
  if (env.cores <= 4 || (env.memoryGB !== null && env.memoryGB <= 4)) return 'simple'
  return 'full'
}

/** Read the live browser environment; safe outside the browser (tests). */
export function detectEnv(): MotionEnv {
  const reduced =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const cores = typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 8
  const deviceMemory = (nav as { deviceMemory?: number } | undefined)?.deviceMemory
  const memory = typeof deviceMemory === 'number' ? deviceMemory : null
  return { reducedMotion: reduced, cores, memoryGB: memory }
}

export function getMode(): AnimationMode {
  try {
    const raw = localStorage.getItem(ANIMATION_STORAGE_KEY)
    return raw === 'on' || raw === 'off' || raw === 'auto' ? raw : 'auto'
  } catch {
    return 'auto'
  }
}

export function setMode(mode: AnimationMode): void {
  try {
    localStorage.setItem(ANIMATION_STORAGE_KEY, mode)
  } catch {
    // Private mode / quota errors must not break the toggle.
  }
}

/** Current effective tier; re-evaluated per call so toggles apply at once. */
export function effectiveLevel(): AnimationLevel {
  return resolveLevel(getMode(), detectEnv())
}

// ─── Shared DOM helpers (used by the animation modules) ────────────

const STYLE_ID = 'poker-anim-styles'

/** Inject the one-off stylesheet for spawned effect nodes. */
export function ensureAnimStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.poker-anim-fx{position:absolute;left:0;top:0;pointer-events:none;z-index:200;will-change:transform,opacity}
.poker-anim-chip{width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#f1d675,#d4af37 55%,#8a6d3b);border:2px dashed rgba(253,252,247,.85);box-shadow:0 2px 6px rgba(0,0,0,.45)}
.poker-anim-card{width:36px;aspect-ratio:5/7;margin:-25px 0 0 -18px;border-radius:4px;background:repeating-linear-gradient(45deg,#8e2420 0 4px,#6d1713 4px 8px);border:1px solid #d4af37;box-shadow:0 2px 8px rgba(0,0,0,.5)}
.poker-anim-card-face{background:#fdfcf7;border-color:#8a6d3b}
.poker-anim-glow{box-shadow:0 0 14px 4px rgba(241,214,117,.75)}
.poker-anim-ring{width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;border:3px solid rgba(241,214,117,.9)}
.poker-anim-label{margin:-12px 0 0 -40px;width:80px;text-align:center;font:700 13px Georgia,serif;color:#f1d675;text-shadow:0 1px 3px rgba(0,0,0,.8)}
.poker-anim-flash{inset:0;margin:0;background:radial-gradient(ellipse at center,rgba(212,175,55,.55),rgba(192,57,43,.35) 60%,transparent 80%)}
`
  document.head.appendChild(style)
}

/** Center point of `el` in the local coordinates of `container`. */
export function centerIn(el: Element, container: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect()
  const base = container.getBoundingClientRect()
  return { x: rect.left - base.left + rect.width / 2, y: rect.top - base.top + rect.height / 2 }
}

/** Spawn an absolutely positioned effect node inside the table surface. */
export function spawnFx(container: HTMLElement, className: string, x: number, y: number): HTMLElement {
  ensureAnimStyles()
  const el = document.createElement('div')
  el.className = `poker-anim-fx ${className}`
  el.style.transform = `translate(${x}px, ${y}px)`
  container.appendChild(el)
  return el
}

/** Kill every animation rooted at the table surface and remove effect nodes. */
export function killTableFx(tableEl: HTMLElement | null): void {
  stopAllPulses()
  if (!tableEl) return
  for (const el of Array.from(tableEl.querySelectorAll('.poker-anim-fx'))) {
    gsap.killTweensOf(el)
    el.remove()
  }
  for (const el of Array.from(tableEl.querySelectorAll('.seat-inner'))) {
    gsap.killTweensOf(el)
  }
  gsap.killTweensOf(tableEl)
}

// ─── Public API (off tier = no-op) ─────────────────────────────────

function active(): boolean {
  return effectiveLevel() !== 'off'
}

export function dealHoleCards(
  tableEl: HTMLElement,
  mySeatEl: HTMLElement | null,
  otherSeatEls: HTMLElement[],
): void {
  if (active()) dealHoleCardsImpl(tableEl, mySeatEl, otherSeatEls)
}

export function revealCommunity(tableEl: HTMLElement, street: StreetName, count: number): void {
  if (active()) revealCommunityImpl(tableEl, street, count)
}

export function flyBetToPot(tableEl: HTMLElement, seatEl: HTMLElement | null, amount: number): void {
  if (active()) flyBetToPotImpl(tableEl, seatEl, amount)
}

export function distributePot(
  tableEl: HTMLElement,
  potEl: HTMLElement | null,
  winnerSeatEls: HTMLElement[],
): void {
  if (active()) distributePotImpl(tableEl, potEl, winnerSeatEls)
}

export function pulseActiveRing(seatEl: HTMLElement | null): void {
  if (active()) pulseImpl(seatEl)
}

export function stopPulse(seatEl: HTMLElement | null): void {
  stopPulseImpl(seatEl)
}

export function celebrateWinners(tableEl: HTMLElement, winnerSeatEls: HTMLElement[]): void {
  if (active()) celebrateImpl(tableEl, winnerSeatEls)
}

export function revealShowdownCards(seatEl: HTMLElement | null): void {
  if (active()) revealCardsImpl(seatEl)
}

export function allInImpact(tableEl: HTMLElement): void {
  if (active()) allInImpactImpl(tableEl)
}
