/**
 * Maps domain cards to bundled SVG asset URLs.
 *
 * Conventions are aligned with backend/domain/card.js:
 * suits use full names ('spades' | 'hearts' | 'diamonds' | 'clubs'),
 * ranks are numeric 2-14 where A=14.
 *
 * Asset file names follow the compact scheme: rank letter + suit letter,
 * e.g. 'AS.svg' (ace of spades), 'TH.svg' (ten of hearts), 'back.svg'.
 */

export type CardSuit = 'spades' | 'hearts' | 'diamonds' | 'clubs'

const SUIT_LETTERS: Record<CardSuit, string> = {
  clubs: 'C',
  diamonds: 'D',
  hearts: 'H',
  spades: 'S',
}

const RANK_LETTERS: Record<number, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
}

// Eagerly bundle every card SVG so runtime lookups stay synchronous.
const assetUrls = import.meta.glob<string>('../assets/cards/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
})

function resolveFile(fileName: string): string {
  const url = assetUrls[`../assets/cards/${fileName}`]
  if (!url) {
    throw new Error(`Missing card asset: ${fileName}`)
  }
  return url
}

/** Resolve the face SVG URL for a domain card (rank 2-14, A=14). */
export function getCardAsset(suit: CardSuit, rank: number): string {
  const suitLetter = SUIT_LETTERS[suit]
  const rankLetter = RANK_LETTERS[rank]
  if (!suitLetter || !rankLetter) {
    throw new Error(`Invalid card: suit=${String(suit)} rank=${String(rank)}`)
  }
  return resolveFile(`${rankLetter}${suitLetter}.svg`)
}

/** Resolve the card-back SVG URL. */
export function getCardBackAsset(): string {
  return resolveFile('back.svg')
}
