/**
 * backend/domain/hand-evaluator.test.js
 *
 * Comprehensive unit tests for the HandEvaluator.
 * Run with: node --test backend/domain/hand-evaluator.test.js
 *
 * Covers all 10 hand rankings + tie-breaking + edge cases + performance.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { Card } = require('./card');
const { HandEvaluator } = require('./hand-evaluator');

function C(suit, rank) { return new Card(suit, rank); }

function assertHandResult(result, expected) {
  assert.strictEqual(result.rank, expected.rank, `Expected rank=${expected.rank}, got ${result.rank}`);
  if (expected.name) {
    assert.strictEqual(result.name, expected.name, `Expected name="${expected.name}", got "${result.name}"`);
  }
  if (expected.kicker !== undefined) {
    assert.strictEqual(result.kickers[0], expected.kicker, 'First kicker mismatch');
  }
  if (expected.kickers) {
    assert.deepStrictEqual(result.kickers, expected.kickers, 'Kickers mismatch');
  }
}

describe('HandEvaluator', () => {
  test('Royal Flush (spades)', () => {
    const cards = [
      C('spades', '10'), C('spades', 'J'), C('spades', 'Q'), C('spades', 'K'), C('spades', 'A'),
      C('hearts', '2'), C('diamonds', '3')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 1, name: 'Royal Flush' });
  });

  test('Royal Flush (hearts)', () => {
    const cards = [
      C('hearts', '10'), C('hearts', 'J'), C('hearts', 'Q'), C('hearts', 'K'), C('hearts', 'A'),
      C('spades', '7'), C('clubs', '4')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 1, name: 'Royal Flush' });
  });

  test('Straight Flush (9-high)', () => {
    const cards = [
      C('hearts', '5'), C('hearts', '6'), C('hearts', '7'), C('hearts', '8'), C('hearts', '9'),
      C('clubs', '2'), C('spades', 'K')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 2, name: 'Straight Flush', kicker: 9 });
  });

  test('Four of a Kind (Aces)', () => {
    const cards = [
      C('spades', 'A'), C('hearts', 'A'), C('diamonds', 'A'), C('clubs', 'A'), C('spades', 'K'),
      C('hearts', '2'), C('diamonds', '3')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 3, name: 'Four of a Kind', kickers: [14, 13] });
  });

  test('Four of a Kind (7s with A kicker)', () => {
    const cards = [
      C('spades', '7'), C('hearts', '7'), C('diamonds', '7'), C('clubs', '7'), C('spades', 'A'),
      C('hearts', '2'), C('diamonds', '3')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 3, name: 'Four of a Kind', kickers: [7, 14] });
  });

  test('Full House (Q over 8)', () => {
    const cards = [
      C('spades', 'Q'), C('hearts', 'Q'), C('diamonds', 'Q'), C('clubs', '8'), C('hearts', '8'),
      C('spades', '2'), C('diamonds', '3')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 4, name: 'Full House', kickers: [12, 8] });
  });

  test('Full House (A over K beats Q over 8)', () => {
    const aFull = HandEvaluator.evaluate([
      C('spades', 'A'), C('hearts', 'A'), C('diamonds', 'A'), C('clubs', 'K'), C('hearts', 'K'),
      C('spades', '2'), C('diamonds', '3')
    ]);
    const qFull = HandEvaluator.evaluate([
      C('spades', 'Q'), C('hearts', 'Q'), C('diamonds', 'Q'), C('clubs', '8'), C('hearts', '8'),
      C('spades', '2'), C('diamonds', '3')
    ]);
    assertHandResult(aFull, { rank: 4, name: 'Full House', kickers: [14, 13] });
    assert.ok(HandEvaluator.beats(aFull, qFull), 'Aces full should beat Queens full');
  });

  test('Flush (diamonds, K-high)', () => {
    const cards = [
      C('diamonds', '2'), C('diamonds', '5'), C('diamonds', '7'), C('diamonds', 'J'), C('diamonds', 'K'),
      C('spades', 'A'), C('hearts', 'Q')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 5, name: 'Flush', kickers: [13, 11, 7, 5, 2] });
  });

  test('Flush vs Flush (K-high beats Q-high)', () => {
    const kFlush = HandEvaluator.evaluate([
      C('diamonds', '2'), C('diamonds', '5'), C('diamonds', '7'), C('diamonds', 'J'), C('diamonds', 'K'),
      C('spades', 'A'), C('hearts', 'Q')
    ]);
    const qFlush = HandEvaluator.evaluate([
      C('clubs', '2'), C('clubs', '5'), C('clubs', '7'), C('clubs', 'J'), C('clubs', 'Q'),
      C('spades', 'A'), C('hearts', 'K')
    ]);
    assert.ok(HandEvaluator.beats(kFlush, qFlush), 'K-high flush should beat Q-high flush');
  });

  test('Straight (9-high)', () => {
    const cards = [
      C('spades', '5'), C('hearts', '6'), C('diamonds', '7'), C('clubs', '8'), C('spades', '9'),
      C('hearts', 'K'), C('diamonds', 'A')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 6, name: 'Straight', kicker: 9 });
  });

  test('Wheel (A-2-3-4-5, Ace-low straight)', () => {
    const cards = [
      C('spades', 'A'), C('hearts', '2'), C('diamonds', '3'), C('clubs', '4'), C('spades', '5'),
      C('hearts', 'K'), C('diamonds', 'Q')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 6, name: 'Straight', kicker: 5 });
  });

  test('Broadway (10-J-Q-K-A, Ace-high straight)', () => {
    const cards = [
      C('spades', '10'), C('hearts', 'J'), C('diamonds', 'Q'), C('clubs', 'K'), C('spades', 'A'),
      C('hearts', '2'), C('diamonds', '3')
    ];
    const r = HandEvaluator.evaluate(cards);
    assertHandResult(r, { rank: 6, name: 'Straight', kicker: 14 });
    const wheel = HandEvaluator.evaluate([
      C('spades', 'A'), C('hearts', '2'), C('diamonds', '3'), C('clubs', '4'), C('spades', '5'),
      C('hearts', 'K'), C('diamonds', 'Q')
    ]);
    assert.ok(HandEvaluator.beats(r, wheel), 'Broadway should beat Wheel');
  });

  test('Three of a Kind (7s)', () => {
    const cards = [
      C('spades', '7'), C('hearts', '7'), C('diamonds', '7'), C('clubs', 'K'), C('spades', '2'),
      C('hearts', '3'), C('diamonds', '4')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 7, name: 'Three of a Kind', kickers: [7, 13, 4] });
  });

  test('Two Pair (J over 5)', () => {
    const cards = [
      C('spades', 'J'), C('hearts', 'J'), C('diamonds', '5'), C('clubs', '5'), C('spades', 'A'),
      C('hearts', '2'), C('diamonds', '3')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 8, name: 'Two Pair', kickers: [11, 5, 14] });
  });

  test('Two Pair kickers (J-5-A beats J-5-Q)', () => {
    const handA = HandEvaluator.evaluate([
      C('spades', 'J'), C('hearts', 'J'), C('diamonds', '5'), C('clubs', '5'), C('spades', 'A'),
      C('hearts', '2'), C('diamonds', '3')
    ]);
    const handB = HandEvaluator.evaluate([
      C('spades', 'J'), C('hearts', 'J'), C('diamonds', '5'), C('clubs', '5'), C('spades', 'Q'),
      C('hearts', '2'), C('diamonds', '3')
    ]);
    assert.ok(HandEvaluator.beats(handA, handB), 'Two pair with A kicker beats Q kicker');
  });

  test('One Pair (10s)', () => {
    const cards = [
      C('spades', '10'), C('hearts', '10'), C('diamonds', 'K'), C('clubs', '7'), C('spades', '3'),
      C('hearts', '2'), C('diamonds', '4')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 9, name: 'One Pair', kickers: [10, 13, 7, 4] });
  });

  test('One Pair comparison (A-pair beats K-pair)', () => {
    const aPair = HandEvaluator.evaluate([
      C('spades', 'A'), C('hearts', 'A'), C('diamonds', 'K'), C('clubs', 'Q'), C('spades', 'J'),
      C('hearts', '9'), C('diamonds', '8')
    ]);
    const kPair = HandEvaluator.evaluate([
      C('spades', 'K'), C('hearts', 'K'), C('diamonds', 'A'), C('clubs', 'Q'), C('spades', 'J'),
      C('hearts', '9'), C('diamonds', '8')
    ]);
    assert.ok(HandEvaluator.beats(aPair, kPair), 'Pair Aces beats Pair Kings');
  });

  test('High Card (A-K-Q-J-9)', () => {
    const cards = [
      C('spades', 'A'), C('diamonds', 'K'), C('hearts', 'Q'), C('clubs', 'J'), C('spades', '9'),
      C('hearts', '7'), C('diamonds', '5')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 10, name: 'High Card', kickers: [14, 13, 12, 11, 9] });
  });

  test('High Card comparison (A-K beats A-Q)', () => {
    const akHigh = HandEvaluator.evaluate([
      C('spades', 'A'), C('diamonds', 'K'), C('hearts', 'Q'), C('clubs', 'J'), C('spades', '9'),
      C('hearts', '7'), C('diamonds', '5')
    ]);
    const aqHigh = HandEvaluator.evaluate([
      C('spades', 'A'), C('diamonds', 'Q'), C('hearts', 'J'), C('clubs', '10'), C('spades', '8'),
      C('hearts', '6'), C('diamonds', '4')
    ]);
    assert.ok(HandEvaluator.beats(akHigh, aqHigh), 'AK-high beats AQ-high');
  });

  test('7-pick-5 optimal: straight beats pocket pair', () => {
    const cards = [
      C('spades', '2'), C('hearts', '2'),
      C('spades', '3'), C('hearts', '4'), C('diamonds', '5'), C('clubs', '6'), C('spades', '7')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 6, name: 'Straight', kicker: 7 });
  });

  test('7-pick-5 optimal: flush beats straight', () => {
    const cards = [
      C('hearts', '2'), C('hearts', '3'),
      C('hearts', '5'), C('hearts', '7'), C('hearts', '9'),
      C('spades', '4'), C('diamonds', '6')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 5, name: 'Flush' });
  });

  test('Tie - identical hands', () => {
    const handA = HandEvaluator.evaluate([
      C('spades', 'A'), C('hearts', 'K'), C('diamonds', 'Q'), C('clubs', 'J'), C('spades', '9'),
      C('hearts', '7'), C('diamonds', '5')
    ]);
    const handB = HandEvaluator.evaluate([
      C('clubs', 'A'), C('diamonds', 'K'), C('hearts', 'Q'), C('spades', 'J'), C('clubs', '9'),
      C('diamonds', '7'), C('hearts', '5')
    ]);
    assert.strictEqual(HandEvaluator.compare(handA, handB), 0, 'Identical hands should tie');
  });

  test('Kicker decides - one pair with different kickers', () => {
    const handA = HandEvaluator.evaluate([
      C('spades', 'A'), C('hearts', 'A'), C('diamonds', 'K'), C('clubs', 'Q'), C('spades', 'J'),
      C('hearts', '9'), C('diamonds', '8')
    ]);
    const handB = HandEvaluator.evaluate([
      C('spades', 'A'), C('hearts', 'A'), C('diamonds', 'Q'), C('clubs', 'J'), C('spades', '2'),
      C('hearts', '9'), C('diamonds', '8')
    ]);
    assert.ok(HandEvaluator.beats(handA, handB), 'Pair Aces with K kicker beats Q kicker');
  });

  test('Straight Flush beats Four of a Kind', () => {
    const sf = HandEvaluator.evaluate([
      C('hearts', '5'), C('hearts', '6'), C('hearts', '7'), C('hearts', '8'), C('hearts', '9'),
      C('spades', 'A'), C('diamonds', 'A')
    ]);
    const fk = HandEvaluator.evaluate([
      C('spades', 'A'), C('hearts', 'A'), C('diamonds', 'A'), C('clubs', 'A'), C('spades', 'K'),
      C('hearts', '2'), C('diamonds', '3')
    ]);
    assert.ok(HandEvaluator.beats(sf, fk), 'Straight Flush should beat Four of a Kind');
  });

  test('Full House beats Flush', () => {
    const fh = HandEvaluator.evaluate([
      C('spades', 'Q'), C('hearts', 'Q'), C('diamonds', 'Q'), C('clubs', '8'), C('hearts', '8'),
      C('spades', '2'), C('diamonds', '3')
    ]);
    const fl = HandEvaluator.evaluate([
      C('diamonds', '2'), C('diamonds', '5'), C('diamonds', '7'), C('diamonds', 'J'), C('diamonds', 'K'),
      C('spades', 'A'), C('hearts', 'Q')
    ]);
    assert.ok(HandEvaluator.beats(fh, fl), 'Full House should beat Flush');
  });

  test('Wheel is a valid straight', () => {
    const cards = [
      C('hearts', 'A'), C('spades', '2'), C('diamonds', '3'), C('clubs', '4'), C('hearts', '5'),
      C('spades', 'K'), C('diamonds', 'Q')
    ];
    assertHandResult(HandEvaluator.evaluate(cards), { rank: 6, name: 'Straight', kicker: 5 });
  });

  test('Duplicate values should not break evaluation', () => {
    const cards = [
      C('spades', 'A'), C('hearts', 'A'), C('diamonds', 'A'), C('clubs', 'A'), C('spades', 'K'),
      C('hearts', 'K'), C('diamonds', 'K')
    ];
    const r = HandEvaluator.evaluate(cards);
    assertHandResult(r, { rank: 3, name: 'Four of a Kind', kickers: [14, 13] });
  });

  test('Performance - 1000 evaluations under 100ms', () => {
    const { Deck } = require('./deck');
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) {
      const d = Deck.createShuffled();
      const cards = d.deal(7);
      HandEvaluator.evaluate(cards);
    }
    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
    assert.ok(elapsed < 100, `1000 evaluations took ${elapsed.toFixed(2)}ms, expected < 100ms`);
  });

  test('Hole card strength - AA is strongest', () => {
    const strength = HandEvaluator.holeCardStrength([C('spades', 'A'), C('hearts', 'A')]);
    assert.ok(strength >= 90, `AA strength should be >= 90, got ${strength}`);
  });

  test('Hole card strength - 72 offsuit is weakest', () => {
    const strength = HandEvaluator.holeCardStrength([C('spades', '7'), C('clubs', '2')]);
    assert.ok(strength < 30, `72o strength should be < 30, got ${strength}`);
  });

  test('Hole card strength - suited connectors better than offsuit', () => {
    const suited = HandEvaluator.holeCardStrength([C('hearts', '9'), C('hearts', '10')]);
    const offsuit = HandEvaluator.holeCardStrength([C('hearts', '9'), C('spades', '10')]);
    assert.ok(suited > offsuit, `Suited 9T (${suited}) should be stronger than offsuit (${offsuit})`);
  });

  test('Rejects non-array input', () => {
    assert.throws(() => HandEvaluator.evaluate(null), /requires exactly 7 cards/);
  });

  test('Rejects wrong card count', () => {
    assert.throws(() => HandEvaluator.evaluate([C('spades', 'A')]), /requires exactly 7 cards/);
  });

  test('Rejects non-Card elements', () => {
    assert.throws(() => HandEvaluator.evaluate([
      C('spades', 'A'), C('hearts', 'K'), C('diamonds', 'Q'), C('clubs', 'J'),
      C('spades', '10'), C('hearts', '9'), { suit: 'spades', rank: '2' }
    ]), /all elements to be Card instances/);
  });
});
