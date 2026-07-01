/**
 * backend/domain/deck.test.js
 *
 * Unit tests for Deck entity.
 * Run with: node --test backend/domain/deck.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { Deck } = require('./deck');
const { Card } = require('./card');

describe('Deck', () => {
  test('new deck has 52 unique cards', () => {
    const deck = new Deck();
    assert.strictEqual(deck.remaining(), 52);
    const strings = deck.cards.map(c => c.toString());
    assert.strictEqual(new Set(strings).size, 52);
  });

  test('shuffle changes order', () => {
    const deck = new Deck();
    const before = deck.cards.map(c => c.toString()).join('');
    deck.shuffle();
    const after = deck.cards.map(c => c.toString()).join('');
    assert.notStrictEqual(before, after);
  });

  test('shuffle preserves all cards', () => {
    const deck = new Deck();
    deck.shuffle();
    assert.strictEqual(deck.remaining(), 52);
    const suits = new Set(deck.cards.map(c => c.suit));
    const ranks = new Set(deck.cards.map(c => c.rank));
    assert.strictEqual(suits.size, 4);
    assert.strictEqual(ranks.size, 13);
  });

  test('deal removes cards', () => {
    const deck = new Deck();
    deck.shuffle();
    const dealt = deck.deal(5);
    assert.strictEqual(dealt.length, 5);
    assert.strictEqual(deck.remaining(), 47);
    assert.ok(dealt.every(c => c instanceof Card));
  });

  test('deal all 52 cards', () => {
    const deck = Deck.createShuffled();
    const all = deck.deal(52);
    assert.strictEqual(all.length, 52);
    assert.strictEqual(deck.remaining(), 0);
  });

  test('deal from empty deck throws', () => {
    const deck = new Deck();
    deck.deal(52);
    assert.throws(() => deck.deal(1), /Not enough cards/);
  });

  test('deal negative count throws', () => {
    const deck = new Deck();
    assert.throws(() => deck.deal(-1), /Cannot deal negative/);
  });

  test('peek does not remove cards', () => {
    const deck = Deck.createShuffled();
    const peeked = deck.peek(3);
    assert.strictEqual(peeked.length, 3);
    assert.strictEqual(deck.remaining(), 52);
  });

  test('peek negative count throws', () => {
    const deck = new Deck();
    assert.throws(() => deck.peek(-1), /Cannot peek negative/);
  });

  test('remove specific card', () => {
    const deck = new Deck();
    const card = new Card('spades', 'A');
    assert.ok(deck.contains(card));
    assert.ok(deck.remove(card));
    assert.strictEqual(deck.remaining(), 51);
    assert.ok(!deck.contains(card));
    assert.ok(!deck.remove(card));
  });

  test('createShuffled returns shuffled deck', () => {
    const deck = Deck.createShuffled();
    assert.strictEqual(deck.remaining(), 52);
    const ordered = new Deck().cards.map(c => c.toString()).join('');
    const shuffled = deck.cards.map(c => c.toString()).join('');
    assert.notStrictEqual(ordered, shuffled);
  });

  test('supports injected deterministic rng', () => {
    // Deterministic rng that always returns 0 rotates the deck left by one:
    // each swap with index 0 moves the current tail card to front, ultimately
    // placing the original first card at the end.
    const rng = () => 0;
    const deck = new Deck(rng);
    const original = deck.cards.map(c => c.toString());
    deck.shuffle();
    const shuffled = deck.cards.map(c => c.toString());

    const expected = [...original.slice(1), original[0]];
    assert.deepStrictEqual(shuffled, expected);
  });
});
