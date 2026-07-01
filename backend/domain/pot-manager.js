/**
 * backend/domain/pot-manager.js - Pot Calculation Engine
 * 
 * Handles bet collection and side pot calculation for Texas Hold'em.
 * Key concepts:
 *   - Main Pot: everyone eligible (up to the smallest all-in amount)
 *   - Side Pot(s): created when a player goes all-in and others keep betting
 *   - Folded players: their bets stay in the pot but they cannot win
 * 
 * This is a PURE calculation module - no external dependencies.
 */

class PotManager {
  /**
   * @param {Array} seats - Array of seat objects:
   *   { position, totalBet, status: 'folded'|'active'|'allin', chips }
   */
  constructor(seats = []) {
    /** @type {Map<number, Object>} position -> bet info */
    this.bets = new Map();

    const seenPositions = new Set();
    for (const seat of seats) {
      if (seat == null || typeof seat.position !== 'number' || !Number.isFinite(seat.position)) {
        throw new Error(`Invalid seat position: ${seat?.position}`);
      }
      if (seenPositions.has(seat.position)) {
        throw new Error(`Duplicate position in PotManager: ${seat.position}`);
      }
      seenPositions.add(seat.position);

      const totalBet = seat.totalBet ?? 0;
      if (typeof totalBet !== 'number' || !Number.isFinite(totalBet) || totalBet < 0) {
        throw new Error(`Invalid totalBet for position ${seat.position}: ${totalBet}`);
      }

      const status = seat.status || 'active';
      if (!['active', 'folded', 'allin'].includes(status)) {
        throw new Error(`Invalid status for position ${seat.position}: ${status}`);
      }

      this.bets.set(seat.position, {
        position: seat.position,
        totalBet,
        status,
        chips: seat.chips ?? 0
      });
    }
  }

  /**
   * Record a bet for a position.
   * @param {number} position - Seat position
   * @param {number} amount - Amount to add to totalBet
   */
  addBet(position, amount) {
    const info = this.bets.get(position);
    if (!info) {
      throw new Error(`Invalid position: ${position}`);
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new Error(`Bet amount must be a non-negative finite number: ${amount}`);
    }
    info.totalBet += amount;
  }

  /**
   * Get current bet info for a position.
   * @param {number} position
   * @returns {Object|null}
   */
  getBet(position) {
    return this.bets.get(position) || null;
  }

  /**
   * Calculate main pot and all side pots.
   * 
   * Algorithm:
   * 1. Sort players by totalBet ascending
   * 2. Slice horizontally at each unique bet level
   * 3. Each slice = (betLevel - prevLevel) × contributors
   * 4. First slice = main pot, rest = side pots
   * 
   * @returns {Object} { mainPot: number, sidePots: Array<{amount, eligiblePositions}> }
   */
  calculatePots() {
    const allPots = this._calculateAllPots();
    if (allPots.length === 0) {
      return { mainPot: 0, sidePots: [] };
    }
    return {
      mainPot: allPots[0].amount,
      sidePots: allPots.slice(1)
    };
  }

  /**
   * Calculate total pot (main + all side pots).
   * @returns {number}
   */
  getTotalPot() {
    const { mainPot, sidePots } = this.calculatePots();
    return mainPot + sidePots.reduce((sum, sp) => sum + sp.amount, 0);
  }

  /**
   * Distribute pots to winners.
   * 
   * @param {Array} winners - Array of { position, handResult } for each non-folded player
   *   handResult should be comparable (has .rank and .kickers, or use HandEvaluator.compare)
   * @param {Function} compareFn - Optional comparison function(handA, handB) -> -1|0|1
   *   Defaults to comparing handResult objects directly (must have rank+kickers).
   * @returns {Object} Map of position -> payout amount
   */
  distribute(winners, compareFn = null) {
    const pots = this._calculateAllPots();
    const payouts = {};

    // Initialize payouts
    for (const p of this.bets.keys()) {
      payouts[p] = 0;
    }

    const defaultCompare = (a, b) => {
      // Compare by rank (lower = stronger) then kickers
      if (a.handResult.rank !== b.handResult.rank) {
        return a.handResult.rank < b.handResult.rank ? 1 : -1;
      }
      const ka = a.handResult.kickers || [];
      const kb = b.handResult.kickers || [];
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        const va = ka[i] || 0;
        const vb = kb[i] || 0;
        if (va > vb) return 1;
        if (va < vb) return -1;
      }
      return 0;
    };

    const cmp = compareFn || defaultCompare;

    for (const pot of pots) {
      if (pot.amount === 0) continue;

      // Filter winners eligible for this pot
      const eligibleWinners = winners.filter(w => pot.eligiblePositions.includes(w.position));

      if (eligibleWinners.length === 0) {
        // No eligible winners (shouldn't happen in normal play)
        // In a real game, this pot would be returned or kept by house
        continue;
      }

      // Find the best hand among eligible
      let best = [eligibleWinners[0]];
      for (let i = 1; i < eligibleWinners.length; i++) {
        const result = cmp(eligibleWinners[i], best[0]);
        if (result > 0) {
          best = [eligibleWinners[i]];
        } else if (result === 0) {
          best.push(eligibleWinners[i]);
        }
      }

      // Split pot among winners (integer division, remainder to first)
      const share = Math.floor(pot.amount / best.length);
      const remainder = pot.amount - share * best.length;

      for (let i = 0; i < best.length; i++) {
        const pos = best[i].position;
        payouts[pos] = (payouts[pos] || 0) + share + (i === 0 ? remainder : 0);
      }
    }

    return payouts;
  }

  /**
   * Reset for a new hand.
   */
  reset() {
    for (const info of this.bets.values()) {
      info.totalBet = 0;
      info.status = 'active';
    }
  }

  /**
   * Set a player's status (e.g., when they fold or go all-in).
   * @param {number} position
   * @param {string} status - 'active', 'folded', 'allin'
   */
  setStatus(position, status) {
    if (!['active', 'folded', 'allin'].includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: active, folded, allin`);
    }
    const info = this.bets.get(position);
    if (info) {
      info.status = status;
    }
  }

  /**
   * Get all positions.
   * @returns {number[]}
   */
  getPositions() {
    return Array.from(this.bets.keys());
  }

  // ─── Internal ──────────────────────────────────────────────────

  /** Calculate all pots with eligible positions (including main pot). */
  _calculateAllPots() {
    const allPlayers = Array.from(this.bets.values()).filter(p => p.totalBet > 0);

    if (allPlayers.length === 0) {
      return [];
    }

    const sorted = [...allPlayers].sort((a, b) => a.totalBet - b.totalBet);
    const pots = [];
    let prevLevel = 0;

    for (const player of sorted) {
      const currentLevel = player.totalBet;
      if (currentLevel === prevLevel) continue;

      const diff = currentLevel - prevLevel;
      const contributors = sorted.filter(p => p.totalBet >= currentLevel).length;
      const potAmount = diff * contributors;

      const eligible = sorted
        .filter(p => p.status !== 'folded' && p.totalBet >= currentLevel)
        .map(p => p.position);

      pots.push({ amount: potAmount, eligiblePositions: eligible });
      prevLevel = currentLevel;
    }

    return pots;
  }
}

// ─── Exports ─────────────────────────────────────────────────────
module.exports = { PotManager };

// ─── Self-Test ───────────────────────────────────────────────────
if (require.main === module) {
  console.log('=== PotManager Self-Test ===\n');

  let passed = 0;
  let failed = 0;

  function assertEq(actual, expected, msg) {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr === expectedStr) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.log(`  ✗ ${msg}`);
      console.log(`    Expected: ${expectedStr}`);
      console.log(`    Actual:   ${actualStr}`);
      failed++;
    }
  }

  // Test 1: Simple 3-way equal bets
  {
    console.log('Test 1: Simple equal bets (3 players, 100 each)');
    const pm = new PotManager([
      { position: 0, totalBet: 100, status: 'active' },
      { position: 1, totalBet: 100, status: 'active' },
      { position: 2, totalBet: 100, status: 'active' }
    ]);
    const pots = pm.calculatePots();
    assertEq(pots.mainPot, 300, 'Main pot = 300');
    assertEq(pots.sidePots.length, 0, 'No side pots');
  }

  // Test 2: One all-in (smaller stack)
  {
    console.log('\nTest 2: One all-in (50/100/100)');
    const pm = new PotManager([
      { position: 0, totalBet: 50, status: 'allin' },
      { position: 1, totalBet: 100, status: 'active' },
      { position: 2, totalBet: 100, status: 'active' }
    ]);
    const pots = pm.calculatePots();
    assertEq(pots.mainPot, 150, 'Main pot = 150 (50×3)');
    assertEq(pots.sidePots.length, 1, 'One side pot');
    assertEq(pots.sidePots[0].amount, 100, 'Side pot = 100 (50×2)');
    assertEq(pots.sidePots[0].eligiblePositions, [1, 2], 'Side pot eligible: positions 1,2');
  }

  // Test 3: Two all-ins
  {
    console.log('\nTest 3: Two all-ins (50/100/200)');
    const pm = new PotManager([
      { position: 0, totalBet: 50, status: 'allin' },
      { position: 1, totalBet: 100, status: 'allin' },
      { position: 2, totalBet: 200, status: 'active' }
    ]);
    const pots = pm.calculatePots();
    assertEq(pots.mainPot, 150, 'Main pot = 150');
    assertEq(pots.sidePots.length, 2, 'Two side pots');
    assertEq(pots.sidePots[0].amount, 100, 'Side pot 1 = 100 (50×2, positions 1,2)');
    // Actually: level 50: 50×3=150 (main), level 100: 50×2=100 (side1), level 200: 100×1=100 (side2)
    // Wait, let me recalculate: sorted = [50, 100, 200]
    // level 50: diff=50, contributors=3, pot=150 (main)
    // level 100: diff=50, contributors=2 (100 and 200), pot=100 (side1)
    // level 200: diff=100, contributors=1 (200), pot=100 (side2)
    // Total = 150+100+100 = 350 = 50+100+200 ✓
    assertEq(pots.sidePots[0].amount, 100, 'Side pot 1 = 100');
    assertEq(pots.sidePots[1].amount, 100, 'Side pot 2 = 100');
    assertEq(pots.sidePots[0].eligiblePositions, [1, 2], 'Side pot 1 eligible: 1,2');
    assertEq(pots.sidePots[1].eligiblePositions, [2], 'Side pot 2 eligible: 2');
  }

  // Test 4: Folded player
  {
    console.log('\nTest 4: Folded player (50 fold, 100, 100)');
    const pm = new PotManager([
      { position: 0, totalBet: 50, status: 'folded' },
      { position: 1, totalBet: 100, status: 'active' },
      { position: 2, totalBet: 100, status: 'active' }
    ]);
    const pots = pm.calculatePots();
    assertEq(pots.mainPot, 150, 'Main pot = 150 (50×3, pos 0,1,2; folded excluded from eligible)');
    // sorted: [50(folded), 100, 100]
    // level 50: diff=50, contributors=3, pot=150, eligible=[1,2]
    // level 100: diff=50, contributors=2, pot=100, eligible=[1,2]
    // mainPot=150, sidePot[0]=100
    // Total = 250 = 50+100+100? No, 50+100+100=250 but wait:
    // Position 0 bet 50, pos 1 bet 100, pos 2 bet 100. Total = 250. Correct.
    assertEq(pots.mainPot, 150, 'Main pot = 150');
    assertEq(pots.sidePots[0].amount, 100, 'Side pot = 100');
    assertEq(pots.sidePots[0].eligiblePositions, [1, 2], 'Folded player excluded');
  }

  // Test 5: Distribution - simple win
  {
    console.log('\nTest 5: Distribution - single winner');
    const pm = new PotManager([
      { position: 0, totalBet: 100, status: 'active' },
      { position: 1, totalBet: 100, status: 'active' },
      { position: 2, totalBet: 100, status: 'active' }
    ]);
    const winners = [
      { position: 0, handResult: { rank: 9, kickers: [14, 13, 12] } },  // Pair Aces
      { position: 1, handResult: { rank: 10, kickers: [14, 13, 12, 11, 9] } }, // High card
      { position: 2, handResult: { rank: 10, kickers: [13, 12, 11, 10, 9] } }  // High card
    ];
    const payouts = pm.distribute(winners);
    assertEq(payouts, { '0': 300, '1': 0, '2': 0 }, 'Winner takes all 300');
  }

  // Test 6: Distribution - split pot
  {
    console.log('\nTest 6: Distribution - tie (split pot)');
    const pm = new PotManager([
      { position: 0, totalBet: 100, status: 'active' },
      { position: 1, totalBet: 100, status: 'active' }
    ]);
    const winners = [
      { position: 0, handResult: { rank: 9, kickers: [14, 13, 12] } },
      { position: 1, handResult: { rank: 9, kickers: [14, 13, 12] } }
    ];
    const payouts = pm.distribute(winners);
    assertEq(payouts, { '0': 100, '1': 100 }, 'Split 200 equally');
  }

  // Test 7: Distribution - odd split
  {
    console.log('\nTest 7: Distribution - odd amount (3-way tie)');
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
    // 300 / 3 = 100 each
    assertEq(payouts, { '0': 100, '1': 100, '2': 100 }, 'Split 300 equally');
  }

  // Test 8: Distribution - side pot scenario
  {
    console.log('\nTest 8: Distribution with side pots');
    const pm = new PotManager([
      { position: 0, totalBet: 50, status: 'allin' },
      { position: 1, totalBet: 100, status: 'active' },
      { position: 2, totalBet: 100, status: 'active' }
    ]);
    // Main pot = 150, side pot = 100
    // Position 0 wins main pot, position 1 wins side pot
    const winners = [
      { position: 0, handResult: { rank: 8, kickers: [13, 12, 14] } },  // Two pair (best in main)
      { position: 1, handResult: { rank: 9, kickers: [14] } },          // Pair Aces (best in side)
      { position: 2, handResult: { rank: 10, kickers: [14] } }          // High card
    ];
    const payouts = pm.distribute(winners);
    assertEq(payouts[0], 150, 'Position 0 wins main pot (150)');
    assertEq(payouts[1], 100, 'Position 1 wins side pot (100)');
    assertEq(payouts[2], 0, 'Position 2 wins nothing');
  }

  // Test 9: addBet incrementally
  {
    console.log('\nTest 9: Incremental betting');
    const pm = new PotManager([
      { position: 0, totalBet: 0, status: 'active' },
      { position: 1, totalBet: 0, status: 'active' }
    ]);
    pm.addBet(0, 10);
    pm.addBet(0, 20);
    pm.addBet(1, 30);
    assertEq(pm.getBet(0).totalBet, 30, 'Position 0 total = 30');
    assertEq(pm.getBet(1).totalBet, 30, 'Position 1 total = 30');
    assertEq(pm.getTotalPot(), 60, 'Total pot = 60');
  }

  // Test 10: Empty / all folded
  {
    console.log('\nTest 10: All players folded (one winner by default)');
    const pm = new PotManager([
      { position: 0, totalBet: 50, status: 'folded' },
      { position: 1, totalBet: 100, status: 'folded' },
      { position: 2, totalBet: 100, status: 'active' }  // Last standing
    ]);
    const pots = pm.calculatePots();
    // All pots eligible only include position 2
    assertEq(pots.mainPot, 150, 'Main pot = 150');
    assertEq(pots.sidePots[0].amount, 100, 'Side pot = 100');
    
    const winners = [
      { position: 2, handResult: { rank: 10, kickers: [14] } }
    ];
    const payouts = pm.distribute(winners);
    assertEq(payouts[2], 250, 'Last standing player wins all (150+100)');
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
}
