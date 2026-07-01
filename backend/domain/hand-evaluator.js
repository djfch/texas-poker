/**
 * backend/domain/hand-evaluator.js - Poker Hand Evaluation Engine
 * 
 * Evaluates the best 5-card hand from 7 cards (2 hole + 5 community).
 * Implements standard Texas Hold'em hand rankings.
 * 
 * Hand Rankings (lower rank number = stronger):
 *   1 = Royal Flush      6 = Straight
 *   2 = Straight Flush   7 = Three of a Kind
 *   3 = Four of a Kind   8 = Two Pair
 *   4 = Full House       9 = One Pair
 *   5 = Flush           10 = High Card
 * 
 * This is a PURE FUNCTION module - no state, no side effects.
 */

const { Card } = require('./card');
const { HAND_RANKS, HAND_NAMES, RANK_VALUES } = require('../config/constants');

// ─── Types ───────────────────────────────────────────────────────
// HandResult = { rank, name, cards: Card[5], kickers: number[] }
// rank: 1=best, 10=worst
// kickers: sorted by importance for tie-breaking

// ─── Main Evaluation ─────────────────────────────────────────────

const HandEvaluator = {
  /**
   * Evaluate the best 5-card hand from 7 cards.
   * @param {Card[]} cards - Array of 7 cards
   * @returns {Object} HandResult with rank, name, cards, kickers
   */
  evaluate(cards) {
    if (!Array.isArray(cards) || cards.length !== 7) {
      throw new Error(`evaluate() requires exactly 7 cards, got ${cards?.length}`);
    }
    if (!cards.every(c => c instanceof Card)) {
      throw new Error('evaluate() requires all elements to be Card instances');
    }

    // Try hand types from strongest to weakest
    const checks = [
      this._checkStraightFlush,
      this._checkFourOfAKind,
      this._checkFullHouse,
      this._checkFlush,
      this._checkStraight,
      this._checkThreeOfAKind,
      this._checkTwoPair,
      this._checkOnePair,
      this._checkHighCard
    ];

    for (const check of checks) {
      const result = check.call(this, cards);
      if (result) return result;
    }

    // Should never reach here (High Card always matches)
    throw new Error('Hand evaluation failed - no hand type matched');
  },

  /**
   * Compare two HandResults.
   * @returns {number} -1 if a < b, 0 if tie, 1 if a > b
   */
  compare(handA, handB) {
    // Lower rank number = stronger hand
    if (handA.rank < handB.rank) return 1;
    if (handA.rank > handB.rank) return -1;

    // Same rank: compare kickers sequentially
    const maxLen = Math.max(handA.kickers.length, handB.kickers.length);
    for (let i = 0; i < maxLen; i++) {
      const ka = handA.kickers[i] || 0;
      const kb = handB.kickers[i] || 0;
      if (ka > kb) return 1;
      if (ka < kb) return -1;
    }

    return 0; // True tie
  },

  /**
   * Check if handA beats handB.
   * @returns {boolean}
   */
  beats(handA, handB) {
    return this.compare(handA, handB) === 1;
  },

  /**
   * Evaluate just 2 hole cards for pre-flop strength (0-100).
   * Used by AI for decision making.
   * @param {Card[]} holeCards - 2 cards
   * @returns {number} 0-100 strength score
   */
  holeCardStrength(holeCards) {
    if (!Array.isArray(holeCards) || holeCards.length !== 2) return 0;

    const [c1, c2] = holeCards;
    const v1 = c1.value;
    const v2 = c2.value;
    const high = Math.max(v1, v2);
    const low = Math.min(v1, v2);
    const suited = c1.suit === c2.suit;
    const pair = v1 === v2;

    // Base score from high card value (2-14 maps to 0-40)
    let score = (high - 2) * 3;

    if (pair) {
      // Pairs: 22=35, 33=40, ..., AA=100
      score = 30 + (high - 2) * 5;
    } else {
      // Non-pairs: bonus for connected cards and suited
      const gap = high - low;
      if (gap === 1) score += 15;        // Connected
      else if (gap === 2) score += 10;   // One gap
      else if (gap === 3) score += 5;    // Two gap
      
      if (suited) score += 8;            // Suited bonus
      if (high >= 10) score += 5;        // High card bonus
    }

    return Math.min(100, Math.max(0, score));
  },

  // ─── Internal: Hand Type Checkers ──────────────────────────────

  /** Check for Straight Flush (including Royal Flush) */
  _checkStraightFlush(cards) {
    const bySuit = this._groupBySuit(cards);

    for (const suitCards of Object.values(bySuit)) {
      if (suitCards.length < 5) continue;

      const straight = this._findStraightInCards(suitCards);
      if (straight) {
        const isRoyal = straight.highValue === 14 && straight.cards.some(c => c.rank === '10');
        const rank = isRoyal ? HAND_RANKS.ROYAL_FLUSH : HAND_RANKS.STRAIGHT_FLUSH;
        const name = HAND_NAMES[rank];
        const kickers = isRoyal ? [] : [straight.highValue];

        return {
          rank,
          name,
          cards: straight.cards,
          kickers
        };
      }
    }
    return null;
  },

  /** Check for Four of a Kind */
  _checkFourOfAKind(cards) {
    const byValue = this._groupByValue(cards);
    const quads = Object.entries(byValue).filter(([_, cs]) => cs.length === 4);

    if (quads.length > 0) {
      // Sort by value descending, take highest quad
      quads.sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
      const [quadValue, quadCards] = quads[0];
      const qv = parseInt(quadValue);

      // Kicker: highest card not in the quad
      const remaining = cards.filter(c => c.value !== qv);
      const kicker = this._highestCards(remaining, 1)[0];

      return {
        rank: HAND_RANKS.FOUR_KIND,
        name: HAND_NAMES[HAND_RANKS.FOUR_KIND],
        cards: [...quadCards, kicker],
        kickers: [qv, kicker.value]
      };
    }
    return null;
  },

  /** Check for Full House */
  _checkFullHouse(cards) {
    const byValue = this._groupByValue(cards);
    const triples = Object.entries(byValue).filter(([_, cs]) => cs.length >= 3);
    const pairs = Object.entries(byValue).filter(([_, cs]) => cs.length >= 2);

    if (triples.length >= 1 && (triples.length >= 2 || pairs.length >= 2)) {
      // Sort triples by value descending
      triples.sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
      
      const [tripValue, tripCards] = triples[0];
      const tv = parseInt(tripValue);

      // Find best pair (can be from another triple)
      let bestPairValue = 0;
      let bestPairCards = null;
      for (const [pv, pcs] of pairs) {
        const pvi = parseInt(pv);
        if (pvi !== tv && pvi > bestPairValue) {
          bestPairValue = pvi;
          bestPairCards = pcs;
        }
      }

      // If no other pair, check if there's another triple
      if (!bestPairCards && triples.length >= 2) {
        const [pv, pcs] = triples[1];
        bestPairValue = parseInt(pv);
        bestPairCards = pcs;
      }

      if (bestPairCards) {
        const tripHand = tripCards.slice(0, 3);
        const pairHand = bestPairCards.slice(0, 2);

        return {
          rank: HAND_RANKS.FULL_HOUSE,
          name: HAND_NAMES[HAND_RANKS.FULL_HOUSE],
          cards: [...tripHand, ...pairHand],
          kickers: [tv, bestPairValue]
        };
      }
    }
    return null;
  },

  /** Check for Flush */
  _checkFlush(cards) {
    const bySuit = this._groupBySuit(cards);

    for (const suitCards of Object.values(bySuit)) {
      if (suitCards.length >= 5) {
        // Take top 5 by value
        const flushCards = this._highestCards(suitCards, 5);
        const kickers = flushCards.map(c => c.value);

        return {
          rank: HAND_RANKS.FLUSH,
          name: HAND_NAMES[HAND_RANKS.FLUSH],
          cards: flushCards,
          kickers
        };
      }
    }
    return null;
  },

  /** Check for Straight (not a straight flush) */
  _checkStraight(cards) {
    const straight = this._findStraightInCards(cards);
    if (straight) {
      return {
        rank: HAND_RANKS.STRAIGHT,
        name: HAND_NAMES[HAND_RANKS.STRAIGHT],
        cards: straight.cards,
        kickers: [straight.highValue]
      };
    }
    return null;
  },

  /** Check for Three of a Kind */
  _checkThreeOfAKind(cards) {
    const byValue = this._groupByValue(cards);
    const triples = Object.entries(byValue).filter(([_, cs]) => cs.length >= 3);

    if (triples.length >= 1) {
      triples.sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
      const [tripValue, tripCards] = triples[0];
      const tv = parseInt(tripValue);

      // Two highest kickers not in the triple
      const remaining = cards.filter(c => c.value !== tv);
      const kickers = this._highestCards(remaining, 2);

      return {
        rank: HAND_RANKS.THREE_KIND,
        name: HAND_NAMES[HAND_RANKS.THREE_KIND],
        cards: [...tripCards.slice(0, 3), ...kickers],
        kickers: [tv, ...kickers.map(c => c.value)]
      };
    }
    return null;
  },

  /** Check for Two Pair */
  _checkTwoPair(cards) {
    const byValue = this._groupByValue(cards);
    const pairs = Object.entries(byValue).filter(([_, cs]) => cs.length >= 2);

    if (pairs.length >= 2) {
      // Sort pairs by value descending
      pairs.sort((a, b) => parseInt(b[0]) - parseInt(a[0]));

      const [highPairValue, highPairCards] = pairs[0];
      const [lowPairValue, lowPairCards] = pairs[1];
      const hpv = parseInt(highPairValue);
      const lpv = parseInt(lowPairValue);

      // Kicker: highest remaining card
      const usedValues = new Set([hpv, lpv]);
      const remaining = cards.filter(c => !usedValues.has(c.value));
      const kicker = this._highestCards(remaining, 1)[0];

      return {
        rank: HAND_RANKS.TWO_PAIR,
        name: HAND_NAMES[HAND_RANKS.TWO_PAIR],
        cards: [highPairCards[0], highPairCards[1], lowPairCards[0], lowPairCards[1], kicker],
        kickers: [hpv, lpv, kicker.value]
      };
    }
    return null;
  },

  /** Check for One Pair */
  _checkOnePair(cards) {
    const byValue = this._groupByValue(cards);
    const pairs = Object.entries(byValue).filter(([_, cs]) => cs.length >= 2);

    if (pairs.length >= 1) {
      pairs.sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
      const [pairValue, pairCards] = pairs[0];
      const pv = parseInt(pairValue);

      // Three highest kickers not in the pair
      const remaining = cards.filter(c => c.value !== pv);
      const kickers = this._highestCards(remaining, 3);

      return {
        rank: HAND_RANKS.ONE_PAIR,
        name: HAND_NAMES[HAND_RANKS.ONE_PAIR],
        cards: [pairCards[0], pairCards[1], ...kickers],
        kickers: [pv, ...kickers.map(c => c.value)]
      };
    }
    return null;
  },

  /** High Card (always matches) */
  _checkHighCard(cards) {
    const top5 = this._highestCards(cards, 5);
    return {
      rank: HAND_RANKS.HIGH_CARD,
      name: HAND_NAMES[HAND_RANKS.HIGH_CARD],
      cards: top5,
      kickers: top5.map(c => c.value)
    };
  },

  // ─── Internal: Utility Functions ───────────────────────────────

  /** Group cards by suit */
  _groupBySuit(cards) {
    const groups = {};
    for (const c of cards) {
      if (!groups[c.suit]) groups[c.suit] = [];
      groups[c.suit].push(c);
    }
    return groups;
  },

  /** Group cards by numeric value */
  _groupByValue(cards) {
    const groups = {};
    for (const c of cards) {
      if (!groups[c.value]) groups[c.value] = [];
      groups[c.value].push(c);
    }
    return groups;
  },

  /** Get n highest-valued cards, sorted descending by value */
  _highestCards(cards, n) {
    return [...cards].sort((a, b) => b.value - a.value).slice(0, n);
  },

  /**
   * Find the best straight in a set of cards.
   * @returns {Object|null} { highValue, cards: Card[5] } or null
   */
  _findStraightInCards(cards) {
    if (cards.length < 5) return null;

    // Get unique values, sorted descending
    const uniqueValues = [...new Set(cards.map(c => c.value))].sort((a, b) => b - a);

    // Special case: A-2-3-4-5 (Ace low straight / wheel)
    // Ace (14) can act as 1
    const hasAce = uniqueValues.includes(14);
    const has2 = uniqueValues.includes(2);
    const has3 = uniqueValues.includes(3);
    const has4 = uniqueValues.includes(4);
    const has5 = uniqueValues.includes(5);

    // Check for wheel (A-2-3-4-5)
    if (hasAce && has2 && has3 && has4 && has5) {
      // Find actual cards for 5,4,3,2 and one Ace
      const getCard = (val, preferSuit) => {
        if (val === 14) {
          // For Ace low, prefer any Ace
          return cards.find(c => c.value === 14);
        }
        return cards.find(c => c.value === val);
      };

      const wheelCards = [
        getCard(5), getCard(4), getCard(3), getCard(2), getCard(14)
      ];

      if (wheelCards.every(c => c)) {
        return { highValue: 5, cards: wheelCards };
      }
    }

    // Check for normal straights (5 consecutive values)
    for (let i = 0; i <= uniqueValues.length - 5; i++) {
      const seq = uniqueValues.slice(i, i + 5);
      // Check if consecutive (descending order, so differences should be 1)
      let isStraight = true;
      for (let j = 0; j < 4; j++) {
        if (seq[j] - seq[j + 1] !== 1) {
          isStraight = false;
          break;
        }
      }

      if (isStraight) {
        // Find actual cards for these values
        const straightCards = [];
        const used = new Set();
        for (const val of seq) {
          const card = cards.find(c => c.value === val && !used.has(c));
          if (card) {
            straightCards.push(card);
            used.add(card);
          }
        }

        if (straightCards.length === 5) {
          return { highValue: seq[0], cards: straightCards };
        }
      }
    }

    return null;
  }
};

// ─── Exports ─────────────────────────────────────────────────────
module.exports = { HandEvaluator };

// ─── Self-Test ───────────────────────────────────────────────────
if (require.main === module) {
  const { Card } = require('./card');

  function C(suit, rank) { return new Card(suit, rank); }

  console.log('=== HandEvaluator Self-Test ===\n');

  const tests = [
    {
      name: 'Royal Flush',
      cards: [
        C('spades', '10'), C('spades', 'J'), C('spades', 'Q'), C('spades', 'K'), C('spades', 'A'),
        C('hearts', '2'), C('diamonds', '3')
      ],
      expectRank: 1
    },
    {
      name: 'Straight Flush',
      cards: [
        C('hearts', '5'), C('hearts', '6'), C('hearts', '7'), C('hearts', '8'), C('hearts', '9'),
        C('clubs', '2'), C('spades', 'K')
      ],
      expectRank: 2
    },
    {
      name: 'Four of a Kind',
      cards: [
        C('spades', 'A'), C('hearts', 'A'), C('diamonds', 'A'), C('clubs', 'A'), C('spades', 'K'),
        C('hearts', '2'), C('diamonds', '3')
      ],
      expectRank: 3
    },
    {
      name: 'Full House',
      cards: [
        C('spades', 'Q'), C('hearts', 'Q'), C('diamonds', 'Q'), C('clubs', '8'), C('hearts', '8'),
        C('spades', '2'), C('diamonds', '3')
      ],
      expectRank: 4
    },
    {
      name: 'Flush',
      cards: [
        C('diamonds', '2'), C('diamonds', '5'), C('diamonds', '7'), C('diamonds', 'J'), C('diamonds', 'K'),
        C('spades', 'A'), C('hearts', 'Q')
      ],
      expectRank: 5
    },
    {
      name: 'Straight',
      cards: [
        C('spades', '5'), C('hearts', '6'), C('diamonds', '7'), C('clubs', '8'), C('spades', '9'),
        C('hearts', 'K'), C('diamonds', 'A')
      ],
      expectRank: 6
    },
    {
      name: 'Three of a Kind',
      cards: [
        C('spades', '7'), C('hearts', '7'), C('diamonds', '7'), C('clubs', 'K'), C('spades', '2'),
        C('hearts', '3'), C('diamonds', '4')
      ],
      expectRank: 7
    },
    {
      name: 'Two Pair',
      cards: [
        C('spades', 'J'), C('hearts', 'J'), C('diamonds', '5'), C('clubs', '5'), C('spades', 'A'),
        C('hearts', '2'), C('diamonds', '3')
      ],
      expectRank: 8
    },
    {
      name: 'One Pair',
      cards: [
        C('spades', '10'), C('hearts', '10'), C('diamonds', 'K'), C('clubs', '7'), C('spades', '3'),
        C('hearts', '2'), C('diamonds', '4')
      ],
      expectRank: 9
    },
    {
      name: 'High Card',
      cards: [
        C('spades', 'A'), C('diamonds', 'K'), C('hearts', '10'), C('clubs', '7'), C('spades', '2'),
        C('hearts', '3'), C('diamonds', '4')
      ],
      expectRank: 10
    },
    {
      name: 'Wheel (A-2-3-4-5 straight)',
      cards: [
        C('spades', 'A'), C('hearts', '2'), C('diamonds', '3'), C('clubs', '4'), C('spades', '5'),
        C('hearts', 'K'), C('diamonds', 'Q')
      ],
      expectRank: 6,
      expectKicker: 5
    },
    {
      name: '7-pick-5: pocket pair vs straight on board',
      cards: [
        C('spades', '2'), C('hearts', '2'),  // pocket pair 2s
        C('spades', '3'), C('hearts', '4'), C('diamonds', '5'), C('clubs', '6'), C('spades', '7')
      ],
      expectRank: 6,  // Straight 3-4-5-6-7 beats pair of 2s
      expectKicker: 7
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = HandEvaluator.evaluate(test.cards);
      const rankOk = result.rank === test.expectRank;
      const kickerOk = test.expectKicker === undefined || result.kickers[0] === test.expectKicker;

      if (rankOk && kickerOk) {
        console.log(`✓ ${test.name}: ${result.name} (rank=${result.rank})`);
        passed++;
      } else {
        console.log(`✗ ${test.name}: FAIL`);
        console.log(`  Expected rank=${test.expectRank}, got rank=${result.rank}`);
        if (test.expectKicker !== undefined) {
          console.log(`  Expected kicker=${test.expectKicker}, got kicker=${result.kickers[0]}`);
        }
        console.log(`  Cards: ${test.cards.map(c => c.toString()).join(' ')}`);
        failed++;
      }
    } catch (e) {
      console.log(`✗ ${test.name}: ERROR - ${e.message}`);
      failed++;
    }
  }

  // Test compare function
  const handA = HandEvaluator.evaluate([
    C('spades', 'A'), C('hearts', 'A'), C('diamonds', 'K'), C('clubs', 'Q'), C('spades', 'J'),
    C('hearts', '9'), C('diamonds', '8')
  ]); // One Pair Aces

  const handB = HandEvaluator.evaluate([
    C('spades', 'K'), C('hearts', 'K'), C('diamonds', 'A'), C('clubs', 'Q'), C('spades', 'J'),
    C('hearts', '9'), C('diamonds', '8')
  ]); // One Pair Kings

  const cmp = HandEvaluator.compare(handA, handB);
  console.log(`\nCompare Test: Pair Aces vs Pair Kings: ${cmp === 1 ? 'PASS' : 'FAIL'} (result=${cmp})`);
  if (cmp === 1) passed++; else failed++;

  // Tie test
  const handC = HandEvaluator.evaluate([
    C('spades', 'A'), C('hearts', 'K'), C('diamonds', 'Q'), C('clubs', 'J'), C('spades', '9'),
    C('hearts', '7'), C('diamonds', '5')
  ]);
  const handD = HandEvaluator.evaluate([
    C('clubs', 'A'), C('diamonds', 'K'), C('hearts', 'Q'), C('spades', 'J'), C('clubs', '9'),
    C('diamonds', '7'), C('hearts', '5')
  ]);
  const cmp2 = HandEvaluator.compare(handC, handD);
  console.log(`Tie Test: Same high card: ${cmp2 === 0 ? 'PASS' : 'FAIL'} (result=${cmp2})`);
  if (cmp2 === 0) passed++; else failed++;

  // Hole card strength test
  const strong = HandEvaluator.holeCardStrength([C('spades', 'A'), C('hearts', 'A')]);
  const weak = HandEvaluator.holeCardStrength([C('spades', '7'), C('clubs', '2')]);
  console.log(`\nHole Card Strength: AA=${strong}, 72o=${weak}`);
  console.log(`AA > 72o: ${strong > weak ? 'PASS' : 'FAIL'}`);
  if (strong > weak) passed++; else failed++;

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
}
