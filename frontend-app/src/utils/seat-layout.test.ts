/**
 * seat-layout.test.ts - Elliptical seat positioning: 2/6/9 seats, portrait
 * and landscape surfaces, different viewer seats and boundary values.
 */

import { describe, expect, it } from 'vitest'
import { computeSeatLayout, findSeatPoint } from '@/utils/seat-layout'

const LANDSCAPE = { width: 1200, height: 700, orientation: 'landscape' as const }
const PORTRAIT = { width: 390, height: 640, orientation: 'portrait' as const }

describe('computeSeatLayout basics', () => {
  it('returns one point per seat, ascending by seatIndex', () => {
    const points = computeSeatLayout({ seatCount: 9, viewerSeatIndex: 0, ...LANDSCAPE })
    expect(points).toHaveLength(9)
    expect(points.map(p => p.seatIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('returns an empty array for a non-positive seat count', () => {
    expect(computeSeatLayout({ seatCount: 0, viewerSeatIndex: null, ...LANDSCAPE })).toEqual([])
    expect(computeSeatLayout({ seatCount: -3, viewerSeatIndex: null, ...LANDSCAPE })).toEqual([])
  })
})

describe('viewer pinning', () => {
  it('pins the viewer seat to the bottom center (landscape)', () => {
    const points = computeSeatLayout({ seatCount: 6, viewerSeatIndex: 0, ...LANDSCAPE })
    const mine = findSeatPoint(points, 0)
    expect(mine?.x).toBeCloseTo(LANDSCAPE.width / 2)
    // Bottom = center + vertical radius.
    expect(mine?.y).toBeCloseTo(LANDSCAPE.height / 2 + LANDSCAPE.height * 0.38)
  })

  it('pins a different viewer seat to the bottom center (portrait)', () => {
    const points = computeSeatLayout({ seatCount: 6, viewerSeatIndex: 2, ...PORTRAIT })
    const mine = findSeatPoint(points, 2)
    expect(mine?.x).toBeCloseTo(PORTRAIT.width / 2)
    expect(mine?.y).toBeCloseTo(PORTRAIT.height / 2 + PORTRAIT.height * 0.4)
  })

  it('places the next seat up the right side and the previous one down-left', () => {
    const points = computeSeatLayout({ seatCount: 6, viewerSeatIndex: 2, ...LANDSCAPE })
    const cx = LANDSCAPE.width / 2
    const cy = LANDSCAPE.height / 2
    const next = findSeatPoint(points, 3)
    const prev = findSeatPoint(points, 1)
    // Legacy order: seat+1 goes to the right-bottom of the viewer.
    expect(next!.x).toBeGreaterThan(cx)
    expect(next!.y).toBeGreaterThan(cy)
    expect(prev!.x).toBeLessThan(cx)
    expect(prev!.y).toBeGreaterThan(cy)
  })

  it('spectator layout (viewer null) starts seat 0 at the bottom', () => {
    const points = computeSeatLayout({ seatCount: 6, viewerSeatIndex: null, ...LANDSCAPE })
    const first = findSeatPoint(points, 0)
    expect(first?.x).toBeCloseTo(LANDSCAPE.width / 2)
    expect(first?.y).toBeGreaterThan(LANDSCAPE.height / 2)
  })
})

describe('seat counts', () => {
  it('2 seats: opponent sits at the top center', () => {
    const points = computeSeatLayout({ seatCount: 2, viewerSeatIndex: 0, ...LANDSCAPE })
    const other = findSeatPoint(points, 1)
    expect(other?.x).toBeCloseTo(LANDSCAPE.width / 2)
    expect(other?.y).toBeCloseTo(LANDSCAPE.height / 2 - LANDSCAPE.height * 0.38)
  })

  it('9 seats: opposite seat (offset 4-5) crosses the top area', () => {
    const points = computeSeatLayout({ seatCount: 9, viewerSeatIndex: 0, ...LANDSCAPE })
    const topSeat = findSeatPoint(points, 4)
    expect(topSeat!.y).toBeLessThan(LANDSCAPE.height / 2)
  })

  it('even spacing: consecutive seats rotate by the same angle', () => {
    const n = 6
    const points = computeSeatLayout({ seatCount: n, viewerSeatIndex: 0, ...LANDSCAPE })
    const cx = LANDSCAPE.width / 2
    const cy = LANDSCAPE.height / 2
    const rx = LANDSCAPE.width * 0.44
    const ry = LANDSCAPE.height * 0.38
    const angles = points.map(p => Math.atan2((p.y - cy) / ry, (p.x - cx) / rx))
    for (let i = 1; i < n; i++) {
      let delta = angles[i - 1]! - angles[i]!
      if (delta < 0) delta += 2 * Math.PI
      expect(delta).toBeCloseTo((2 * Math.PI) / n)
    }
  })
})

describe('orientation and boundaries', () => {
  it('portrait uses a vertical ellipse, landscape a horizontal one', () => {
    const square = { width: 800, height: 800 }
    const portrait = computeSeatLayout({ seatCount: 2, viewerSeatIndex: 0, ...square, orientation: 'portrait' })
    const landscape = computeSeatLayout({ seatCount: 2, viewerSeatIndex: 0, ...square, orientation: 'landscape' })
    const pTop = findSeatPoint(portrait, 1)!
    const lTop = findSeatPoint(landscape, 1)!
    // Top-seat distance from center exposes the vertical radius.
    const pRy = 400 - pTop.y
    const lRy = 400 - lTop.y
    expect(pRy).toBeGreaterThan(800 * 0.38) // portrait ry > portrait rx
    expect(lRy).toBeLessThan(800 * 0.44) // landscape ry < landscape rx
  })

  it('single seat sits at the bottom center', () => {
    const points = computeSeatLayout({ seatCount: 1, viewerSeatIndex: 0, ...PORTRAIT })
    expect(points).toHaveLength(1)
    expect(points[0]?.x).toBeCloseTo(PORTRAIT.width / 2)
    expect(points[0]?.y).toBeCloseTo(PORTRAIT.height / 2 + PORTRAIT.height * 0.4)
  })

  it('viewer index wraps around the seat count', () => {
    const points = computeSeatLayout({ seatCount: 9, viewerSeatIndex: 8, ...LANDSCAPE })
    // Seat 0 follows seat 8, so it goes to the right of the viewer.
    const seat0 = findSeatPoint(points, 0)!
    expect(seat0.x).toBeGreaterThan(LANDSCAPE.width / 2)
  })
})
