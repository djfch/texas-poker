/**
 * backend/domain/card.ts - Card Entity
 *
 * Represents a single playing card with suit and rank.
 * Pure domain object - no external dependencies.
 */

import { RANK_VALUES, SUIT_SYMBOLS, CARD_SUITS, CARD_RANKS } from '../config/constants';

export type Suit = (typeof CARD_SUITS)[number];
export type Rank = (typeof CARD_RANKS)[number];

const SUITS: readonly string[] = CARD_SUITS;
const RANKS: readonly string[] = CARD_RANKS;

export interface CardJSON {
  suit: string;
  rank: string;
}

export class Card {
  readonly suit: Suit;
  readonly rank: Rank;

  /**
   * @param suit - One of: 'hearts', 'diamonds', 'clubs', 'spades'
   * @param rank - One of: '2'..'10', 'J', 'Q', 'K', 'A'
   */
  constructor(suit: string, rank: string) {
    if (!SUITS.includes(suit)) {
      throw new Error(`Invalid suit: ${suit}. Must be one of: ${SUITS.join(', ')}`);
    }
    if (!RANKS.includes(rank)) {
      throw new Error(`Invalid rank: ${rank}. Must be one of: ${RANKS.join(', ')}`);
    }
    this.suit = suit as Suit;
    this.rank = rank as Rank;
  }

  /** Numeric value for comparison (2=2, ..., A=14) */
  get value(): number {
    return RANK_VALUES[this.rank];
  }

  /** Symbol for display (♥ ♦ ♣ ♠) */
  get suitSymbol(): string {
    return SUIT_SYMBOLS[this.suit];
  }

  /** @returns e.g. "A♠" */
  toString(): string {
    return `${this.rank}${this.suitSymbol}`;
  }

  /** @returns Serializable plain object */
  toJSON(): CardJSON {
    return { suit: this.suit, rank: this.rank };
  }

  /** Create Card from a plain object */
  static fromJSON(obj: any): Card {
    if (!obj || typeof obj !== 'object') {
      throw new Error('Invalid card JSON: expected an object with suit and rank');
    }
    return new Card(obj.suit, obj.rank);
  }

  /** Numeric rank value for any valid rank string */
  static rankValue(rank: string): number {
    return RANK_VALUES[rank as Rank];
  }

  /**
   * Compare two cards by rank value.
   * @returns -1 if a < b, 0 if equal, 1 if a > b
   */
  static compare(cardA: Card, cardB: Card): number {
    const va = cardA.value;
    const vb = cardB.value;
    if (va < vb) return -1;
    if (va > vb) return 1;
    return 0;
  }

  /** Check if two cards are equal (same suit and rank) */
  equals(other: unknown): boolean {
    return other instanceof Card && this.suit === other.suit && this.rank === other.rank;
  }

  /** Create a copy of this card */
  clone(): Card {
    return new Card(this.suit, this.rank);
  }
}

// ─── Helper Functions ────────────────────────────────────────────

/** Display string for a card: e.g. 'A♠' */
export function displayCard(card: Card): string {
  return card.toString();
}

/** Display string for multiple cards */
export function displayCards(cards: Card[]): string {
  return cards.map(c => displayCard(c)).join(' ');
}

/** Check if suit is red (hearts or diamonds) */
export function isRed(suit: string): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

/** Check if suit is black (clubs or spades) */
export function isBlack(suit: string): boolean {
  return suit === 'clubs' || suit === 'spades';
}

// ─── Exports ─────────────────────────────────────────────────────
export { SUITS, RANKS, SUIT_SYMBOLS };

// ─── Self-Test ───────────────────────────────────────────────────
if (require.main === module) {
  console.log('=== Card Self-Test ===');

  const c1 = new Card('spades', 'A');
  const c2 = new Card('hearts', 'K');
  const c3 = new Card('spades', 'A');

  console.log(`Card A♠: value=${c1.value}, symbol=${c1.suitSymbol}`);
  console.log(`Card K♥: value=${c2.value}`);
  console.log(`A♠ > K♥? ${Card.compare(c1, c2) === 1 ? 'PASS' : 'FAIL'}`);
  console.log(`A♠ == A♠? ${c1.equals(c3) ? 'PASS' : 'FAIL'}`);
  console.log(`Display: ${displayCards([c1, c2])}`);
  console.log(`Red check (hearts): ${isRed('hearts') ? 'PASS' : 'FAIL'}`);
  console.log(`Black check (clubs): ${isBlack('clubs') ? 'PASS' : 'FAIL'}`);
  console.log('=== Card Self-Test Complete ===');
}
