/**
 * animations.test.ts - Tier ladder pure logic (resolveLevel / detectEnv with
 * mocked browser APIs) plus behavioral guards: animations are always on
 * (full or simple), and every API silently degrades when its hook elements
 * are missing (never throws).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allInImpact,
  celebrateWinners,
  dealHoleCards,
  detectEnv,
  distributePot,
  effectiveLevel,
  flyBetToPot,
  killTableFx,
  pulseActiveRing,
  resolveLevel,
  revealCommunity,
  revealShowdownCards,
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

describe('resolveLevel (pure tier ladder, always on)', () => {
  it('prefers-reduced-motion degrades to simple (never off)', () => {
    expect(resolveLevel({ ...NORMAL_ENV, reducedMotion: true })).toBe('simple')
    expect(resolveLevel({ reducedMotion: true, cores: 2, memoryGB: 2 })).toBe('simple')
  })

  it('degrades low-end devices to simple', () => {
    expect(resolveLevel({ ...NORMAL_ENV, cores: 4 })).toBe('simple')
    expect(resolveLevel({ ...NORMAL_ENV, cores: 2 })).toBe('simple')
    expect(resolveLevel({ ...NORMAL_ENV, memoryGB: 4 })).toBe('simple')
    expect(resolveLevel({ ...NORMAL_ENV, memoryGB: 0.5 })).toBe('simple')
  })

  it('is full on capable devices and tolerates unknown memory', () => {
    expect(resolveLevel(NORMAL_ENV)).toBe('full')
    expect(resolveLevel({ ...NORMAL_ENV, memoryGB: null })).toBe('full')
    expect(resolveLevel({ ...NORMAL_ENV, cores: 6, memoryGB: 6 })).toBe('full')
  })
})

describe('effectiveLevel (live environment)', () => {
  it('resolves to full or simple, never off', () => {
    expect(['full', 'simple']).toContain(effectiveLevel())
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

describe('missing elements: silent degradation', () => {
  it('against an empty table never throws', () => {
    const empty = document.createElement('div')
    document.body.appendChild(empty)
    expect(() => callAllApis(empty)).not.toThrow()
  })

  it('tolerates null seats and pots', () => {
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

describe('effects actually spawn (always on)', () => {
  it('dealHoleCards spawns flying card nodes from the deck', () => {
    const table = buildTableDom()
    dealHoleCards(table, seat(table, 1), [seat(table, 2)])
    expect(table.querySelectorAll('.poker-anim-card').length).toBeGreaterThan(0)
  })

  it('flyBetToPot spawns a chip', () => {
    const table = buildTableDom()
    flyBetToPot(table, seat(table, 1), 200)
    expect(table.querySelectorAll('.poker-anim-chip').length).toBeGreaterThan(0)
  })

  it('killTableFx removes spawned effect nodes', () => {
    const table = buildTableDom()
    dealHoleCards(table, seat(table, 1), [seat(table, 2)])
    flyBetToPot(table, seat(table, 1), 50)
    expect(table.querySelectorAll('.poker-anim-fx').length).toBeGreaterThan(0)
    killTableFx(table)
    expect(table.querySelectorAll('.poker-anim-fx')).toHaveLength(0)
  })
})
