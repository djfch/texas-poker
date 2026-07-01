/**
 * backend/domain/card.test.js
 *
 * Unit tests for Card entity.
 * Run with: node --test backend/domain/card.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { Card, SUITS, RANKS, displayCard, displayCards, isRed, isBlack } = require('./card');

describe('Card', () => {
  test('constructs a valid card', () => {
    const card = new Card('spades', 'A');
    assert.strictEqual(card.suit, 'spades');
    assert.strictEqual(card.rank, 'A');
    assert.strictEqual(card.value, 14);
    assert.strictEqual(card.suitSymbol, '♠');
  });

  test('rejects invalid suit', () => {
    assert.throws(() => new Card('stars', 'A'), /Invalid suit/);
  });

  test('rejects invalid rank', () => {
    assert.throws(() => new Card('spades', '1'), /Invalid rank/);
  });

  test('value maps 2-14 correctly', () => {
    assert.strictEqual(new Card('hearts', '2').value, 2);
    assert.strictEqual(new Card('hearts', '10').value, 10);
    assert.strictEqual(new Card('hearts', 'J').value, 11);
    assert.strictEqual(new Card('hearts', 'Q').value, 12);
    assert.strictEqual(new Card('hearts', 'K').value, 13);
    assert.strictEqual(new Card('hearts', 'A').value, 14);
  });

  test('toString returns rank + suit symbol', () => {
    assert.strictEqual(new Card('spades', 'A').toString(), 'A♠');
    assert.strictEqual(new Card('hearts', '10').toString(), '10♥');
  });

  test('toJSON returns serializable object', () => {
    const card = new Card('diamonds', 'K');
    assert.deepStrictEqual(card.toJSON(), { suit: 'diamonds', rank: 'K' });
  });

  test('fromJSON reconstructs card', () => {
    const card = Card.fromJSON({ suit: 'clubs', rank: '7' });
    assert.strictEqual(card.suit, 'clubs');
    assert.strictEqual(card.rank, '7');
    assert.strictEqual(card.value, 7);
  });

  test('fromJSON rejects invalid input', () => {
    assert.throws(() => Card.fromJSON(null), /Invalid card JSON/);
    assert.throws(() => Card.fromJSON('spades,A'), /Invalid card JSON/);
  });

  test('rankValue returns numeric rank', () => {
    assert.strictEqual(Card.rankValue('A'), 14);
    assert.strictEqual(Card.rankValue('2'), 2);
  });

  test('compare orders cards by value', () => {
    const ace = new Card('spades', 'A');
    const king = new Card('hearts', 'K');
    const ace2 = new Card('diamonds', 'A');
    assert.strictEqual(Card.compare(ace, king), 1);
    assert.strictEqual(Card.compare(king, ace), -1);
    assert.strictEqual(Card.compare(ace, ace2), 0);
  });

  test('equals checks suit and rank', () => {
    const a1 = new Card('spades', 'A');
    const a2 = new Card('spades', 'A');
    const a3 = new Card('hearts', 'A');
    assert.ok(a1.equals(a2));
    assert.ok(!a1.equals(a3));
    assert.ok(!a1.equals(null));
    assert.ok(!a1.equals({ suit: 'spades', rank: 'A' }));
  });

  test('clone creates independent copy', () => {
    const original = new Card('spades', 'A');
    const copy = original.clone();
    assert.ok(original.equals(copy));
    assert.notStrictEqual(original, copy);
  });

  test('displayCard and displayCards format correctly', () => {
    const cards = [new Card('spades', 'A'), new Card('hearts', 'K')];
    assert.strictEqual(displayCard(cards[0]), 'A♠');
    assert.strictEqual(displayCards(cards), 'A♠ K♥');
  });

  test('isRed and isBlack identify colors', () => {
    assert.ok(isRed('hearts'));
    assert.ok(isRed('diamonds'));
    assert.ok(!isRed('spades'));
    assert.ok(isBlack('spades'));
    assert.ok(isBlack('clubs'));
    assert.ok(!isBlack('hearts'));
  });

  test('SUITS and RANKS exported', () => {
    assert.deepStrictEqual(SUITS, ['hearts', 'diamonds', 'clubs', 'spades']);
    assert.strictEqual(RANKS.length, 13);
    assert.strictEqual(RANKS[0], '2');
    assert.strictEqual(RANKS[12], 'A');
  });
});
