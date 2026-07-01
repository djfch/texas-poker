/**
 * backend/domain/deck.js - Deck Entity
 * 
 * Standard 52-card deck with Fisher-Yates shuffle.
 * Pure domain object - depends only on Card.
 */

const { Card, SUITS, RANKS } = require('./card');
const { randomInt } = require('crypto');

class Deck {
  constructor(rng = randomInt) {
    /** @type {Card[]} */
    this.cards = [];
    this._rng = rng;
    this._reset();
  }

  /** Generate a new ordered deck of 52 cards */
  _reset() {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push(new Card(suit, rank));
      }
    }
  }

  /**
   * Fisher-Yates in-place shuffle.
   * Time: O(n), Space: O(1)
   */
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = this._rng(0, i + 1);
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  /**
   * Deal n cards from the top of the deck.
   * @param {number} n - Number of cards to deal
   * @returns {Card[]} Dealt cards (removed from deck)
   */
  deal(n) {
    if (n < 0) throw new Error(`Cannot deal negative cards: ${n}`);
    if (n > this.cards.length) {
      throw new Error(`Not enough cards. Requested: ${n}, remaining: ${this.cards.length}`);
    }
    return this.cards.splice(0, n);
  }

  /** @returns {number} Number of cards remaining */
  remaining() {
    return this.cards.length;
  }

  /**
   * Peek at top n cards without removing them.
   * @param {number} n 
   * @returns {Card[]}
   */
  peek(n) {
    if (n < 0) throw new Error(`Cannot peek negative cards: ${n}`);
    return this.cards.slice(0, Math.min(n, this.cards.length));
  }

  /** Remove a specific card from the deck (useful for testing) */
  remove(card) {
    const idx = this.cards.findIndex(c => c.equals(card));
    if (idx !== -1) {
      this.cards.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** Check if deck contains a specific card */
  contains(card) {
    return this.cards.some(c => c.equals(card));
  }

  /** Create a fresh shuffled deck (factory method) */
  static createShuffled() {
    const deck = new Deck();
    deck.shuffle();
    return deck;
  }
}

// ─── Exports ─────────────────────────────────────────────────────
module.exports = { Deck };

// ─── Self-Test ───────────────────────────────────────────────────
if (require.main === module) {
  console.log('=== Deck Self-Test ===');

  // Test 1: New deck has 52 cards
  const d1 = new Deck();
  console.log(`New deck has 52 cards: ${d1.remaining() === 52 ? 'PASS' : 'FAIL'} (${d1.remaining()})`);

  // Test 2: Shuffle changes order
  const d2 = new Deck();
  const before = d2.cards.map(c => c.toString()).join('');
  d2.shuffle();
  const after = d2.cards.map(c => c.toString()).join('');
  console.log(`Shuffle changes order: ${before !== after ? 'PASS' : 'FAIL'}`);

  // Test 3: Deal reduces count
  const dealt = d2.deal(5);
  console.log(`Deal 5 cards: ${dealt.length === 5 ? 'PASS' : 'FAIL'} (${dealt.length})`);
  console.log(`Remaining after deal: ${d2.remaining() === 47 ? 'PASS' : 'FAIL'} (${d2.remaining()})`);

  // Test 4: Deal all cards
  const d3 = Deck.createShuffled();
  const all = d3.deal(52);
  console.log(`Deal all 52: ${all.length === 52 ? 'PASS' : 'FAIL'}`);
  console.log(`Empty after dealing all: ${d3.remaining() === 0 ? 'PASS' : 'FAIL'}`);

  // Test 5: Deal from empty throws
  try {
    d3.deal(1);
    console.log('Deal from empty throws: FAIL (no error)');
  } catch (e) {
    console.log(`Deal from empty throws: PASS (${e.message})`);
  }

  // Test 6: Peek doesn't remove
  const d4 = Deck.createShuffled();
  const peeked = d4.peek(3);
  console.log(`Peek returns 3: ${peeked.length === 3 ? 'PASS' : 'FAIL'}`);
  console.log(`Peek doesn't remove: ${d4.remaining() === 52 ? 'PASS' : 'FAIL'}`);

  // Test 7: No duplicates after shuffle
  const d5 = Deck.createShuffled();
  const seen = new Set();
  let dup = false;
  for (const c of d5.cards) {
    const key = c.toString();
    if (seen.has(key)) { dup = true; break; }
    seen.add(key);
  }
  console.log(`No duplicates: ${!dup ? 'PASS' : 'FAIL'}`);

  // Test 8: All suits represented
  const suits = new Set(d5.cards.map(c => c.suit));
  console.log(`All 4 suits present: ${suits.size === 4 ? 'PASS' : 'FAIL'}`);

  // Test 9: All ranks represented
  const ranks = new Set(d5.cards.map(c => c.rank));
  console.log(`All 13 ranks present: ${ranks.size === 13 ? 'PASS' : 'FAIL'}`);

  console.log('=== Deck Self-Test Complete ===');
}
