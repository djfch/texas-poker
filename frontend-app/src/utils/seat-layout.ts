/**
 * seat-layout.ts - Pure elliptical seat positioning for the poker table.
 *
 * Semantics (mirrors legacy frontend/js/views/table.js SEAT_POSITIONS):
 * - The viewer's own seat is pinned to the bottom center.
 * - Remaining seats are evenly spaced around the ellipse, the next seat
 *   (seatIndex + 1) going up the right side first, then across the top.
 * - Portrait surfaces use a vertical ellipse, landscape a horizontal one.
 *
 * Coordinates are absolute pixels inside the table-surface container; the
 * seat element itself is centered on the point via translate(-50%, -50%).
 */

export type TableOrientation = 'portrait' | 'landscape'

export interface SeatLayoutInput {
  /** Total number of seat slots on the table (typically room.maxPlayers). */
  seatCount: number
  /** The viewer's own seat index, or null when spectating. */
  viewerSeatIndex: number | null
  /** Table-surface size in px. */
  width: number
  height: number
  orientation: TableOrientation
}

export interface SeatPoint {
  x: number
  y: number
  seatIndex: number
}

/** Ellipse radius ratios per orientation (fraction of width / height). */
const RADIUS_RATIOS: Record<TableOrientation, { rx: number; ry: number }> = {
  portrait: { rx: 0.38, ry: 0.4 },
  landscape: { rx: 0.44, ry: 0.38 },
}

/** Angle of a seat offset in screen coords: 0 = bottom, then up the right. */
function seatAngle(offset: number, seatCount: number): number {
  return Math.PI / 2 - (offset * 2 * Math.PI) / seatCount
}

/**
 * Compute one point per seat index (ascending). offset 0 sits at the bottom
 * center; offset k is rotated k steps around the ellipse.
 */
export function computeSeatLayout(input: SeatLayoutInput): SeatPoint[] {
  const { seatCount, viewerSeatIndex, width, height, orientation } = input
  if (!Number.isInteger(seatCount) || seatCount <= 0) return []

  const ratios = RADIUS_RATIOS[orientation] ?? RADIUS_RATIOS.landscape
  const cx = width / 2
  const cy = height / 2
  const rx = width * ratios.rx
  const ry = height * ratios.ry

  const points: SeatPoint[] = []
  for (let seatIndex = 0; seatIndex < seatCount; seatIndex++) {
    const offset =
      viewerSeatIndex === null
        ? seatIndex
        : (seatIndex - viewerSeatIndex + seatCount) % seatCount
    const angle = seatAngle(offset, seatCount)
    points.push({
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      seatIndex,
    })
  }
  return points
}

/** Convenience lookup of one seat's point from a computed layout. */
export function findSeatPoint(
  points: SeatPoint[],
  seatIndex: number,
): SeatPoint | undefined {
  return points.find(p => p.seatIndex === seatIndex)
}
