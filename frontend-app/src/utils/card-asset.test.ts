import { describe, expect, it } from 'vitest'
import { getCardAsset, getCardBackAsset, type CardSuit } from './card-asset'

const SUITS: CardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs']

describe('card-asset', () => {
  it('resolves all 52 face cards to distinct URLs', () => {
    const urls = new Set<string>()
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank += 1) {
        urls.add(getCardAsset(suit, rank))
      }
    }
    expect(urls.size).toBe(52)
  })

  it('maps A=14 per the backend RANK_VALUES convention', () => {
    expect(getCardAsset('spades', 14)).toContain('AS.svg')
    expect(getCardAsset('hearts', 10)).toContain('TH.svg')
    expect(getCardAsset('clubs', 13)).toContain('KC.svg')
    expect(getCardAsset('diamonds', 2)).toContain('2D.svg')
  })

  it('resolves the card back', () => {
    expect(getCardBackAsset()).toContain('back.svg')
  })

  it('rejects out-of-range ranks', () => {
    expect(() => getCardAsset('spades', 1)).toThrow()
    expect(() => getCardAsset('spades', 15)).toThrow()
  })
})
