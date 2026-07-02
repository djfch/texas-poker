/**
 * backend/config/constants.js - Game Configuration Constants
 * 
 * All hardcoded game parameters centralized for easy tuning.
 * No mutable state here - pure constants only.
 */

const constants = Object.freeze({
  // ─── Server & Runtime ──────────────────────────────────────────
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  HOST: process.env.HOST || '0.0.0.0',

  // ─── CORS ────────────────────────────────────────────────────────
  CORS_ORIGINS: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),

  // ─── Rate Limiting ───────────────────────────────────────────────
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,

  // ─── Table & Game Settings ─────────────────────────────────────
  MAX_SEATS: 9,
  MIN_PLAYERS: 2,
  DEFAULT_MAX_PLAYERS: 6,

  // ─── Blind & Chip Defaults ─────────────────────────────────────
  DEFAULT_SMALL_BLIND: 10,
  DEFAULT_BIG_BLIND: 20,
  DEFAULT_INITIAL_CHIPS: 1000,

  // ─── Timing ────────────────────────────────────────────────────
  ACTION_TIMEOUT_MS: 30000,      // 30 seconds per action
  ACTION_WARNING_MS: 10000,      // Last 10 seconds show warning
  DISCONNECT_TIMEOUT_MS: 60000,  // 60 seconds to reconnect

  // ─── AI Settings ───────────────────────────────────────────────
  AI_PROVIDER: process.env.AI_PROVIDER || 'openai-compatible',
  AI_BASE_URL: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  AI_API_KEY: process.env.AI_API_KEY || '',
  AI_MODEL: process.env.AI_MODEL || 'gpt-4o-mini',
  AI_TIMEOUT_MS: parseInt(process.env.AI_TIMEOUT_MS, 10) || 10000,
  AI_TEMPERATURE: parseFloat(process.env.AI_TEMPERATURE) || 0.4,
  AI_MAX_TOKENS: parseInt(process.env.AI_MAX_TOKENS, 10) || 256,
  AI_FALLBACK_ENABLED: (process.env.AI_FALLBACK_ENABLED || 'true').toLowerCase() === 'true',

  AI_DELAY_MIN_MS: 1000,
  AI_DELAY_MAX_MS: 5000,

  // ─── Room Settings ─────────────────────────────────────────────
  ROOM_ID_LENGTH: 6,

  // ─── Guest Identity Pool ───────────────────────────────────────
  GUEST_NAMES: Object.freeze([
    'Ace', 'King', 'Queen', 'Jack', 'Joker', 'Dealer',
    'River', 'Flush', 'Bluff', 'Check', 'Raise', 'Fold',
    'Stack', 'Chip', 'Flush', 'Royal', 'Straight', 'Diamond',
    'Spade', 'Heart', 'Club', 'Pocket', 'Trips', 'Boat'
  ]),
  GUEST_AVATARS: Object.freeze([
    '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7',
    '#dfe6e9', '#fd79a8', '#a29bfe', '#00b894', '#e17055',
    '#74b9ff', '#55efc4', '#ff7675', '#fab1a0', '#81ecec'
  ]),

  // ─── AI Identity Pool ──────────────────────────────────────────
  AI_NAMES: Object.freeze([
    'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon',
    'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa',
    'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron'
  ]),
  AI_STYLES: Object.freeze(['tight', 'loose', 'balanced']),

  // ─── Card Definitions ──────────────────────────────────────────
  CARD_SUITS: Object.freeze(['hearts', 'diamonds', 'clubs', 'spades']),
  CARD_RANKS: Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']),

  // Rank values for comparison (Ace high = 14, 2 = 2)
  RANK_VALUES: Object.freeze({
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
    '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
  }),

  // Suit symbols for display
  SUIT_SYMBOLS: Object.freeze({
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  }),

  // ─── Hand Rankings (lower number = stronger hand) ──────────────
  HAND_RANKS: Object.freeze({
    ROYAL_FLUSH: 1,
    STRAIGHT_FLUSH: 2,
    FOUR_KIND: 3,
    FULL_HOUSE: 4,
    FLUSH: 5,
    STRAIGHT: 6,
    THREE_KIND: 7,
    TWO_PAIR: 8,
    ONE_PAIR: 9,
    HIGH_CARD: 10
  }),

  // Human-readable hand names (indexed by rank number)
  HAND_NAMES: Object.freeze({
    1: 'Royal Flush',
    2: 'Straight Flush',
    3: 'Four of a Kind',
    4: 'Full House',
    5: 'Flush',
    6: 'Straight',
    7: 'Three of a Kind',
    8: 'Two Pair',
    9: 'One Pair',
    10: 'High Card'
  }),

  // 中文牌型名称（摊牌时显示）
  HAND_NAMES_CN: Object.freeze({
    1: '皇家同花顺',
    2: '同花顺',
    3: '四条',
    4: '葫芦',
    5: '同花',
    6: '顺子',
    7: '三条',
    8: '两对',
    9: '一对',
    10: '高牌'
  }),

  // ─── Betting Rules ─────────────────────────────────────────────
  MIN_RAISE_MULTIPLIER: 2  // Minimum raise = 2 × last raise increment
});

/**
 * Return a fresh copy of the configuration object.
 * Useful for tests and for safely reading values after env changes.
 */
function getConfig() {
  return { ...constants };
}

function getConfig() {
  return { ...constants };
}

module.exports = { ...constants, getConfig };
