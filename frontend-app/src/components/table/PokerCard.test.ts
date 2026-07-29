/**
 * PokerCard.test.ts - Card rendering: CardJSON and CardString inputs map to
 * the right SVG asset, null/faceDown/malformed inputs fall back to the
 * card back.
 */

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PokerCard from '@/components/table/PokerCard.vue'

describe('face-up mapping', () => {
  it('maps CardJSON { spades, A } to the AS.svg asset', () => {
    const wrapper = mount(PokerCard, { props: { card: { suit: 'spades', rank: 'A' } } })
    const img = wrapper.find('img')
    expect(img.attributes('src')).toContain('AS.svg')
    expect(wrapper.attributes('data-suit')).toBe('spades')
    expect(wrapper.attributes('data-rank')).toBe('A')
    expect(wrapper.attributes('data-face')).toBe('up')
  })

  it('maps CardString "10♥" to the TH.svg asset', () => {
    const wrapper = mount(PokerCard, { props: { card: '10♥' } })
    expect(wrapper.find('img').attributes('src')).toContain('TH.svg')
    expect(wrapper.attributes('data-suit')).toBe('hearts')
    expect(wrapper.attributes('data-rank')).toBe('10')
  })

  it('maps CardString "K♣" to the KC.svg asset', () => {
    const wrapper = mount(PokerCard, { props: { card: 'K♣' } })
    expect(wrapper.find('img').attributes('src')).toContain('KC.svg')
  })
})

describe('card back fallback', () => {
  it('renders the back for a null card', () => {
    const wrapper = mount(PokerCard, { props: { card: null } })
    expect(wrapper.find('img').attributes('src')).toContain('back.svg')
    expect(wrapper.attributes('data-face')).toBe('down')
  })

  it('renders the back when faceDown even with a valid card', () => {
    const wrapper = mount(PokerCard, {
      props: { card: { suit: 'hearts', rank: 'Q' }, faceDown: true },
    })
    expect(wrapper.find('img').attributes('src')).toContain('back.svg')
  })

  it('renders the back for a malformed card string without throwing', () => {
    const wrapper = mount(PokerCard, { props: { card: 'Joker' } })
    expect(wrapper.find('img').attributes('src')).toContain('back.svg')
  })
})
