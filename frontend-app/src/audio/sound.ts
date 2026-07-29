/**
 * audio/sound.ts - Web Audio synthesized sound effects (no assets, no
 * network, offline-friendly). A single lazily-created AudioContext drives
 * short oscillator+envelope blips for the poker table events. Sound is
 * always on (no mute switch); browsers block audio until the first user
 * gesture, so initAudioUnlock() resumes the context on the first
 * pointer/key/touch interaction. Every public call is failure-guarded:
 * an audio error must never break rendering.
 */

export type SoundName = 'deal' | 'chip' | 'allin' | 'fold' | 'check' | 'turn' | 'win'

/** Master output level for all effects (kept modest so it is not intrusive). */
const MASTER_GAIN = 0.18

type WindowWithWebkit = Window &
  typeof globalThis & { webkitAudioContext?: typeof AudioContext }

let ctx: AudioContext | null = null
let master: GainNode | null = null

/** Lazily create (once) the shared AudioContext + master gain. */
function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  master = ctx.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(ctx.destination)
  return ctx
}

/**
 * Resume the AudioContext on the first user gesture. Browsers start it in a
 * 'suspended' state until then; the listeners self-remove after one run.
 * Safe to call more than once.
 */
export function initAudioUnlock(): void {
  if (typeof window === 'undefined') return
  const unlock = (): void => {
    try {
      const context = getContext()
      if (context && context.state === 'suspended') void context.resume()
    } catch {
      // Ignore: audio unlock is best-effort.
    }
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
    window.removeEventListener('touchstart', unlock)
  }
  window.addEventListener('pointerdown', unlock, { once: false })
  window.addEventListener('keydown', unlock, { once: false })
  window.addEventListener('touchstart', unlock, { once: false })
}

/** One oscillator voice with a short attack/decay gain envelope. */
interface Voice {
  type: OscillatorType
  /** Start frequency (Hz). */
  freq: number
  /** Optional glide target frequency (Hz) reached over the voice duration. */
  slideTo?: number
  /** Seconds from the batch start before this voice sounds. */
  at?: number
  /** Voice length in seconds. */
  duration: number
  /** Peak gain (relative to master). */
  gain?: number
}

/** Schedule a batch of voices on the shared context relative to now. */
function playVoices(voices: Voice[]): void {
  const context = getContext()
  if (!context || !master) return
  // A user gesture may not have unlocked it yet; try to resume, but never
  // throw if the browser still refuses.
  if (context.state === 'suspended') {
    try {
      void context.resume()
    } catch {
      // best-effort
    }
  }
  const start = context.currentTime
  for (const v of voices) {
    const osc = context.createOscillator()
    const env = context.createGain()
    const t0 = start + (v.at ?? 0)
    const t1 = t0 + v.duration
    const peak = v.gain ?? 1

    osc.type = v.type
    osc.frequency.setValueAtTime(v.freq, t0)
    if (v.slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, v.slideTo), t1)
    }

    // Fast attack, exponential-ish decay to near-zero (avoid clicks).
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(peak, t0 + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, t1)

    osc.connect(env)
    env.connect(master)
    osc.start(t0)
    osc.stop(t1 + 0.02)
  }
}

/** Voice recipes per event. Kept small and punchy. */
const RECIPES: Record<SoundName, Voice[]> = {
  // Quick high tick as a card lands.
  deal: [{ type: 'triangle', freq: 1250, duration: 0.06, gain: 0.6 }],
  // Two short bright blips: a chip settling into the pot.
  chip: [
    { type: 'square', freq: 880, duration: 0.05, gain: 0.5 },
    { type: 'square', freq: 1320, at: 0.05, duration: 0.06, gain: 0.5 },
  ],
  // Heavier two-tone descending hit for an all-in.
  allin: [
    { type: 'sawtooth', freq: 440, slideTo: 160, duration: 0.28, gain: 0.7 },
    { type: 'square', freq: 220, at: 0.04, duration: 0.24, gain: 0.4 },
  ],
  // Low downward swoosh for a fold.
  fold: [{ type: 'sine', freq: 420, slideTo: 150, duration: 0.22, gain: 0.6 }],
  // Two soft low knocks for a check (table tap).
  check: [
    { type: 'sine', freq: 200, duration: 0.06, gain: 0.7 },
    { type: 'sine', freq: 190, at: 0.12, duration: 0.06, gain: 0.7 },
  ],
  // Pleasant rising two-note alert when it is the viewer's turn.
  turn: [
    { type: 'triangle', freq: 660, duration: 0.12, gain: 0.6 },
    { type: 'triangle', freq: 880, at: 0.12, duration: 0.16, gain: 0.6 },
  ],
  // Ascending C-E-G arpeggio for a win.
  win: [
    { type: 'triangle', freq: 523, duration: 0.16, gain: 0.6 },
    { type: 'triangle', freq: 659, at: 0.12, duration: 0.16, gain: 0.6 },
    { type: 'triangle', freq: 784, at: 0.24, duration: 0.28, gain: 0.7 },
  ],
}

/** Play one named effect. Silently no-ops if audio is unavailable/blocked. */
export function playSound(name: SoundName): void {
  try {
    const recipe = RECIPES[name]
    if (recipe) playVoices(recipe)
  } catch {
    // Sound is decorative: never let an audio error surface.
  }
}
