/**
 * backend/domain/pot-manager.test.js
 *
 * Comprehensive unit tests for PotManager.
 * Run with: node --test backend/domain/pot-manager.test.js
 *
 * Covers main pots, side pots, all-in scenarios, folded players,
 * tie-breaking distribution, and edge cases.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { PotManager } = require('./pot-manager');

describe('PotManager', () => {
  test('Simple pot - 3 players bet 100 each', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 100, status: 'active' },
      { position: 1, totalBet: 100, status: 'active' },
      { position: 2, totalBet: 100, status: 'active' }
    ]);
    const pots = pm.calculatePots();
    assert.strictEqual(pots.mainPot, 300, 'Main pot');
    assert.strictEqual(pots.sidePots.length, 0, 'No side pots');
    assert.strictEqual(pm.getTotalPot(), 300, 'Total pot');
  });

  test('One all-in - main pot + side pot', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 50, status: 'allin' },
      { position: 1, totalBet: 100, status: 'active' },
      { position: 2, totalBet: 100, status: 'active' }
    ]);
    const pots = pm.calculatePots();
    assert.strictEqual(pots.mainPot, 150, 'Main pot = 50×3');
    assert.strictEqual(pots.sidePots.length, 1, 'One side pot');
    assert.strictEqual(pots.sidePots[0].amount, 100, 'Side pot = 50×2');
    assert.deepStrictEqual(pots.sidePots[0].eligiblePositions, [1, 2], 'Side pot eligible');
    assert.strictEqual(pm.getTotalPot(), 250, 'Total = 50+100+100');
  });

  test('Two all-ins - main + 2 side pots', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 50, status: 'allin' },
      { position: 1, totalBet: 100, status: 'allin' },
      { position: 2, totalBet: 200, status: 'active' }
    ]);
    const pots = pm.calculatePots();
    assert.strictEqual(pots.mainPot, 150, 'Main pot = 50×3');
    assert.strictEqual(pots.sidePots.length, 2, 'Two side pots');
    assert.strictEqual(pots.sidePots[0].amount, 100, 'Side pot 1 = 50×2');
    assert.strictEqual(pots.sidePots[1].amount, 100, 'Side pot 2 = 100×1');
    assert.deepStrictEqual(pots.sidePots[0].eligiblePositions, [1, 2], 'SP1 eligible');
    assert.deepStrictEqual(pots.sidePots[1].eligiblePositions, [2], 'SP2 eligible');
  });

  test('4 players all-in at different amounts', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 50, status: 'allin' },
      { position: 1, totalBet: 100, status: 'allin' },
      { position: 2, totalBet: 200, status: 'allin' },
      { position: 3, totalBet: 200, status: 'active' }
    ]);
    const pots = pm.calculatePots();
    assert.strictEqual(pots.mainPot, 200, 'Main = 50×4');
    assert.strictEqual(pots.sidePots.length, 2, 'Two side pots');
    assert.strictEqual(pots.sidePots[0].amount, 150, 'SP1 = 50×3');
    assert.strictEqual(pots.sidePots[1].amount, 200, 'SP2 = 100×2');
    assert.strictEqual(pm.getTotalPot(), 550, 'Total = 50+100+200+200');
  });

  test('Folded player - bets stay but cannot win', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 50, status: 'folded' },
      { position: 1, totalBet: 100, status: 'active' },
      { position: 2, totalBet: 100, status: 'active' }
    ]);
    const pots = pm.calculatePots();
    assert.strictEqual(pots.mainPot, 150, 'Main pot includes folded bet');
    assert.strictEqual(pots.sidePots[0].amount, 100, 'Side pot');

    const winners = [
      { position: 1, handResult: { rank: 9, kickers: [14] } },
      { position: 2, handResult: { rank: 10, kickers: [13] } }
    ];
    const payouts = pm.distribute(winners);
    assert.strictEqual(payouts[1], 250, 'Pos 1 wins everything');
    assert.strictEqual(payouts[2], 0, 'Pos 2 loses');
  });

  test('Distribution - single winner takes all', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 100, status: 'active' },
      { position: 1, totalBet: 100, status: 'active' },
      { position: 2, totalBet: 100, status: 'active' }
    ]);
    const winners = [
      { position: 0, handResult: { rank: 9, kickers: [14] } },
      { position: 1, handResult: { rank: 10, kickers: [14] } },
      { position: 2, handResult: { rank: 10, kickers: [13] } }
    ];
    const payouts = pm.distribute(winners);
    assert.strictEqual(payouts[0], 300, 'Winner takes 300');
    assert.strictEqual(payouts[1], 0, 'Loser gets 0');
    assert.strictEqual(payouts[2], 0, 'Loser gets 0');
  });

  test('Distribution - 2-way tie splits pot evenly', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 100, status: 'active' },
      { position: 1, totalBet: 100, status: 'active' }
    ]);
    const winners = [
      { position: 0, handResult: { rank: 9, kickers: [14, 13] } },
      { position: 1, handResult: { rank: 9, kickers: [14, 13] } }
    ];
    const payouts = pm.distribute(winners);
    assert.strictEqual(payouts[0], 100, 'Split 200 / 2 = 100');
    assert.strictEqual(payouts[1], 100, 'Split 200 / 2 = 100');
  });

  test('Distribution - 3-way tie, odd pot remainder to first winner', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 100, status: 'active' },
      { position: 1, totalBet: 100, status: 'active' },
      { position: 2, totalBet: 100, status: 'active' }
    ]);
    const winners = [
      { position: 0, handResult: { rank: 9, kickers: [14] } },
      { position: 1, handResult: { rank: 9, kickers: [14] } },
      { position: 2, handResult: { rank: 9, kickers: [14] } }
    ];
    const payouts = pm.distribute(winners);
    assert.strictEqual(payouts[0], 100, 'Even split');
    assert.strictEqual(payouts[1], 100, 'Even split');
    assert.strictEqual(payouts[2], 100, 'Even split');
  });

  test('Distribution - odd pot (101) remainder to first winner', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 51, status: 'active' },
      { position: 1, totalBet: 50, status: 'active' }
    ]);
    const pots = pm.calculatePots();
    assert.strictEqual(pots.mainPot, 100, 'Main = 50×2');
    assert.strictEqual(pots.sidePots[0].amount, 1, 'Side = 1×1');

    const winners = [
      { position: 0, handResult: { rank: 9, kickers: [14] } },
      { position: 1, handResult: { rank: 9, kickers: [14] } }
    ];
    const payouts = pm.distribute(winners);
    assert.strictEqual(payouts[0], 51, 'Pos 0 gets 50+1');
    assert.strictEqual(payouts[1], 50, 'Pos 1 gets 50');
  });

  test('Different winners for main pot and side pot', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 50, status: 'allin' },
      { position: 1, totalBet: 100, status: 'active' },
      { position: 2, totalBet: 100, status: 'active' }
    ]);
    const winners = [
      { position: 0, handResult: { rank: 8, kickers: [13, 12, 14] } },
      { position: 1, handResult: { rank: 9, kickers: [14] } },
      { position: 2, handResult: { rank: 10, kickers: [14] } }
    ];
    const payouts = pm.distribute(winners);
    assert.strictEqual(payouts[0], 150, 'Pos 0 wins main pot');
    assert.strictEqual(payouts[1], 100, 'Pos 1 wins side pot');
    assert.strictEqual(payouts[2], 0, 'Pos 2 wins nothing');
  });

  test('addBet accumulates correctly', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 0, status: 'active' },
      { position: 1, totalBet: 0, status: 'active' }
    ]);
    pm.addBet(0, 10);
    pm.addBet(1, 20);
    pm.addBet(0, 20);
    pm.addBet(1, 30);

    assert.strictEqual(pm.getBet(0).totalBet, 30, 'Pos 0 total = 10+20');
    assert.strictEqual(pm.getBet(1).totalBet, 50, 'Pos 1 total = 20+30');
    assert.strictEqual(pm.getTotalPot(), 80, 'Total = 30+50');
  });

  test('addBet rejects invalid amount', () => {
    const pm = new PotManager([{ position: 0, totalBet: 0, status: 'active' }]);
    assert.throws(() => pm.addBet(0, -10), /non-negative finite number/);
    assert.throws(() => pm.addBet(0, '100'), /non-negative finite number/);
    assert.throws(() => pm.addBet(0, NaN), /non-negative finite number/);
  });

  test('Constructor rejects duplicate positions', () => {
    assert.throws(() => new PotManager([
      { position: 0, totalBet: 100, status: 'active' },
      { position: 0, totalBet: 200, status: 'active' }
    ]), /Duplicate position/);
  });

  test('Constructor rejects invalid totalBet', () => {
    assert.throws(() => new PotManager([
      { position: 0, totalBet: -10, status: 'active' }
    ]), /Invalid totalBet/);
    assert.throws(() => new PotManager([
      { position: 0, totalBet: '100', status: 'active' }
    ]), /Invalid totalBet/);
  });

  test('setStatus rejects invalid status', () => {
    const pm = new PotManager([{ position: 0, totalBet: 100, status: 'active' }]);
    assert.throws(() => pm.setStatus(0, 'invalid'), /Invalid status/);
  });

  test('Last standing player wins entire pot', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 50, status: 'folded' },
      { position: 1, totalBet: 100, status: 'folded' },
      { position: 2, totalBet: 100, status: 'active' }
    ]);
    const winners = [
      { position: 2, handResult: { rank: 10, kickers: [14] } }
    ];
    const payouts = pm.distribute(winners);
    assert.strictEqual(payouts[2], 250, 'Last player wins all 250');
  });

  test('reset() clears all bets for new hand', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 100, status: 'folded' },
      { position: 1, totalBet: 200, status: 'active' }
    ]);
    assert.strictEqual(pm.getTotalPot(), 300, 'Before reset');
    pm.reset();
    assert.strictEqual(pm.getBet(0).totalBet, 0, 'After reset pos 0');
    assert.strictEqual(pm.getBet(1).totalBet, 0, 'After reset pos 1');
    assert.strictEqual(pm.getBet(0).status, 'active', 'Status reset to active');
    assert.strictEqual(pm.getTotalPot(), 0, 'Total pot after reset');
  });

  test('No bets = empty pot', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 0, status: 'active' },
      { position: 1, totalBet: 0, status: 'active' }
    ]);
    const pots = pm.calculatePots();
    assert.strictEqual(pots.mainPot, 0, 'Empty main pot');
    assert.strictEqual(pots.sidePots.length, 0, 'No side pots');
  });

  test('Complex - all-in + fold + active at multiple tiers', () => {
    const pm = new PotManager([
      { position: 0, totalBet: 30, status: 'folded' },
      { position: 1, totalBet: 60, status: 'allin' },
      { position: 2, totalBet: 100, status: 'active' },
      { position: 3, totalBet: 100, status: 'active' }
    ]);
    const pots = pm.calculatePots();
    assert.strictEqual(pots.mainPot, 120, 'Main = 30×4');
    assert.strictEqual(pots.sidePots.length, 2, 'Two side pots');
    assert.strictEqual(pots.sidePots[0].amount, 90, 'SP1 = 30×3');
    assert.strictEqual(pots.sidePots[1].amount, 80, 'SP2 = 40×2');
    assert.deepStrictEqual(pots.sidePots[0].eligiblePositions, [1, 2, 3], 'SP1 eligible');
    assert.deepStrictEqual(pots.sidePots[1].eligiblePositions, [2, 3], 'SP2 eligible');
    assert.strictEqual(pm.getTotalPot(), 290, 'Total = 30+60+100+100');
  });
});
