/**
 * card-string.ts - Parse wire card strings back into structured cards.
 *
 * The backend sends most cards as Card.toString() output, e.g. 'A♠' or
 * '10♥' (rank text + suit symbol). game:dealt instead sends CardJSON
 * ({ suit, rank }) so no parsing is needed there.
 */

import type { CardJSON, CardRank, CardSuit } from '@/types'

const SYMBOL_TO_SUIT: Record<string, CardSuit> = {
  '♥': 'hearts',
  '♦': 'diamonds',
  '♣': 'clubs',
  '♠': 'spades',
}

const RANK_TEXTS: readonly CardRank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
]

/**
 * Parse a CardString like 'A♠' or '10♥' into CardJSON.
 * Returns null for malformed input (defensive; wire data should be valid).
 */
export function parseCardString(card: string): CardJSON | null {
  if (typeof card !== 'string' || card.length < 2) return null
  const symbol = card.slice(-1)
  const rankText = card.slice(0, -1)
  const suit = SYMBOL_TO_SUIT[symbol]
  if (!suit) return null
  if (!RANK_TEXTS.includes(rankText as CardRank)) return null
  return { suit, rank: rankText as CardRank }
}

/** Parse a list of card strings, dropping entries that fail to parse. */
export function parseCardStrings(cards: string[]): CardJSON[] {
  const parsed: CardJSON[] = []
  for (const card of cards) {
    const c = parseCardString(card)
    if (c) parsed.push(c)
  }
  return parsed
}
