/**
 * animations.test.ts - Tier ladder pure logic (resolveLevel / getMode /
 * setMode / detectEnv with mocked browser APIs) plus behavioral guards:
 * the off tier turns every API into a no-op, and every API silently
 * degrades when its hook elements are missing (never throws).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANIMATION_STORAGE_KEY,
  allInImpact,
  celebrateWinners,
  dealHoleCards,
  detectEnv,
  distributePot,
  effectiveLevel,
  flyBetToPot,
  getMode,
  killTableFx,
  pulseActiveRing,
  resolveLevel,
  revealCommunity,
  revealShowdownCards,
  setMode,
  stopPulse,
  type MotionEnv,
} from '@/animations/index'

const NORMAL_ENV: MotionEnv = { reducedMotion: false, cores: 8, memoryGB: 8 }

/** Table DOM carrying every animation hook used by the modules. */
function buildTableDom(): HTMLElement {
  const table = document.createElement('div')
  table.innerHTML = `
    <div data-deck></div>
    <div data-pot><div class="pot-main"><span class="pot-value">¥100</span></div></div>
    <div data-community>
      <div data-community-index="0"><div class="poker-card"></div></div>
      <div data-community-index="1"><div class="poker-card"></div></div>
      <div data-community-index="2"><div class="poker-card"></div></div>
      <div data-community-index="3"><div class="poker-card"></div></div>
      <div data-community-index="4"><div class="poker-card"></div></div>
    </div>
    <div class="table-seat" data-seat-index="1">
      <div class="seat-ring"></div>
      <div class="seat-inner">
        <div class="seat-cards"><div class="poker-card"></div><div class="poker-card"></div></div>
      </div>
      <div class="seat-bet" data-seat-bet></div>
    </div>
    <div class="table-seat" data-seat-index="2">
      <div class="seat-ring"></div>
      <div class="seat-inner"></div>
    </div>
  `
  document.body.appendChild(table)
  return table
}

function seat(table: HTMLElement, index: number): HTMLElement {
  return table.querySelector(`[data-seat-index="${index}"]`) as HTMLElement
}

/** Exercise every public API against a (possibly empty) table element. */
function callAllApis(table: HTMLElement): void {
  const s1 = seat(table, 1) ?? null
  dealHoleCards(table, s1, [seat(table, 2)].filter(Boolean) as HTMLElement[])
  revealCommunity(table, 'flop', 3)
  revealCommunity(table, 'turn', 1)
  flyBetToPot(table, s1, 200)
  distributePot(table, table.querySelector('[data-pot]'), s1 ? [s1] : [])
  pulseActiveRing(s1)
  stopPulse(s1)
  celebrateWinners(table, s1 ? [s1] : [])
  revealShowdownCards(s1)
  allInImpact(table)
  killTableFx(table)
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolveLevel (pure tier ladder)', () => {
  it('mode off always wins', () => {
    expect(resolveLevel('off', NORMAL_ENV)).toBe('off')
    expect(resolveLevel('off', { reducedMotion: false, cores: 1, memoryGB: 1 })).toBe('off')
  })

  it('mode on forces full, even on low-end devices', () => {
    expect(resolveLevel('on', NORMAL_ENV)).toBe('full')
    expect(resolveLevel('on', { reducedMotion: true, cores: 2, memoryGB: 2 })).toBe('full')
  })

  it('auto respects prefers-reduced-motion', () => {
    expect(resolveLevel('auto', { ...NORMAL_ENV, reducedMotion: true })).toBe('off')
  })

  it('auto degrades low-end devices to simple', () => {
    expect(resolveLevel('auto', { ...NORMAL_ENV, cores: 4 })).toBe('simple')
    expect(resolveLevel('auto', { ...NORMAL_ENV, cores: 2 })).toBe('simple')
    expect(resolveLevel('auto', { ...NORMAL_ENV, memoryGB: 4 })).toBe('simple')
    expect(resolveLevel('auto', { ...NORMAL_ENV, memoryGB: 0.5 })).toBe('simple')
  })

  it('auto is full on capable devices and tolerates unknown memory', () => {
    expect(resolveLevel('auto', NORMAL_ENV)).toBe('full')
    expect(resolveLevel('auto', { ...NORMAL_ENV, memoryGB: null })).toBe('full')
    expect(resolveLevel('auto', { ...NORMAL_ENV, cores: 6, memoryGB: 6 })).toBe('full')
  })
})

describe('mode persistence (localStorage)', () => {
  it('defaults to auto and round-trips explicit modes', () => {
    expect(getMode()).toBe('auto')
    setMode('off')
    expect(localStorage.getItem(ANIMATION_STORAGE_KEY)).toBe('off')
    expect(getMode()).toBe('off')
    setMode('on')
    expect(getMode()).toBe('on')
  })

  it('falls back to auto for unknown stored values', () => {
    localStorage.setItem(ANIMATION_STORAGE_KEY, 'fancy')
    expect(getMode()).toBe('auto')
  })

  it('effectiveLevel combines mode and environment', () => {
    setMode('off')
    expect(effectiveLevel()).toBe('off')
    setMode('on')
    expect(effectiveLevel()).toBe('full')
  })
})

describe('detectEnv (mocked browser APIs)', () => {
  it('reads prefers-reduced-motion and device hints', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true })
    vi.stubGlobal('matchMedia', matchMedia)
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia
    Object.defineProperty(window.navigator, 'hardwareConcurrency', { value: 2, configurable: true })
    const env = detectEnv()
    expect(env.reducedMotion).toBe(true)
    expect(env.cores).toBe(2)
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })

  it('survives environments without matchMedia', () => {
    const original = window.matchMedia
    // @ts-expect-error - simulate a browser without matchMedia
    window.matchMedia = undefined
    expect(detectEnv().reducedMotion).toBe(false)
    window.matchMedia = original
  })
})

describe('off tier: every API is a no-op', () => {
  it('spawns nothing and never throws', () => {
    setMode('off')
    const table = buildTableDom()
    expect(() => callAllApis(table)).not.toThrow()
    expect(table.querySelectorAll('.poker-anim-fx')).toHaveLength(0)
  })
})

describe('missing elements: silent degradation', () => {
  it('full tier against an empty table never throws', () => {
    setMode('on')
    const empty = document.createElement('div')
    document.body.appendChild(empty)
    expect(() => callAllApis(empty)).not.toThrow()
  })

  it('tolerates null seats and pots', () => {
    setMode('on')
    const table = buildTableDom()
    expect(() => {
      dealHoleCards(table, null, [])
      flyBetToPot(table, null, 100)
      distributePot(table, null, [])
      pulseActiveRing(null)
      stopPulse(null)
      revealShowdownCards(null)
      killTableFx(null)
    }).not.toThrow()
  })
})

describe('full tier: effects actually spawn', () => {
  it('dealHoleCards spawns flying card nodes from the deck', () => {
    setMode('on')
    const table = buildTableDom()
    dealHoleCards(table, seat(table, 1), [seat(table, 2)])
    expect(table.querySelectorAll('.poker-anim-card').length).toBeGreaterThan(0)
  })

  it('flyBetToPot spawns a chip and counts the pot up', () => {
    setMode('on')
    const table = buildTableDom()
    flyBetToPot(table, seat(table, 1), 200)
    expect(table.querySelectorAll('.poker-anim-chip').length).toBeGreaterThan(0)
  })

  it('killTableFx removes spawned effect nodes', () => {
    setMode('on')
    const table = buildTableDom()
    dealHoleCards(table, seat(table, 1), [seat(table, 2)])
    flyBetToPot(table, seat(table, 1), 50)
    expect(table.querySelectorAll('.poker-anim-fx').length).toBeGreaterThan(0)
    killTableFx(table)
    expect(table.querySelectorAll('.poker-anim-fx')).toHaveLength(0)
  })
})
