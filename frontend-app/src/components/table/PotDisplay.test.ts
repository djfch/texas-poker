/**
 * PotDisplay.test.ts - Pot rendering: the primary number is the total pot
 * (explicit when finite, otherwise main + sides, mirroring legacy
 * resolveTotalPot); side pots render as "边池 N" rows.
 */

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { SidePot } from '@/types'
import PotDisplay from '@/components/table/PotDisplay.vue'

const SIDE_POTS: SidePot[] = [
  { amount: 50, eligiblePositions: [0, 1] },
  { amount: 30, eligiblePositions: [1] },
]

describe('total pot resolution', () => {
  it('shows the explicit totalPot when provided', () => {
    const wrapper = mount(PotDisplay, {
      props: { mainPot: 100, sidePots: SIDE_POTS, totalPot: 180 },
    })
    expect(wrapper.find('[data-testid="pot-value"]').text()).toBe('¥180')
  })

  it('falls back to main + sides when totalPot is not finite', () => {
    const wrapper = mount(PotDisplay, {
      props: { mainPot: 100, sidePots: SIDE_POTS, totalPot: null },
    })
    expect(wrapper.find('[data-testid="pot-value"]').text()).toBe('¥180')
  })
})

describe('side pot rows', () => {
  it('renders one "边池 N" row per side pot with amounts', () => {
    const wrapper = mount(PotDisplay, {
      props: { mainPot: 100, sidePots: SIDE_POTS, totalPot: 180 },
    })
    const rows = wrapper.findAll('[data-testid="side-pot"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('边池 1')
    expect(rows[0]!.text()).toContain('¥50')
    expect(rows[1]!.text()).toContain('边池 2')
    expect(rows[1]!.text()).toContain('¥30')
  })

  it('renders no side rows for an empty side-pot list', () => {
    const wrapper = mount(PotDisplay, {
      props: { mainPot: 100, sidePots: [], totalPot: 100 },
    })
    expect(wrapper.findAll('[data-testid="side-pot"]')).toHaveLength(0)
  })
})
