/**
 * backend/storage/game-serializer.ts - Domain-aware game record (de)serialization
 *
 * Game records produced by the game engine are NOT plain JSON: they hold
 * class instances (Deck, PotManager, Card) and a Set (actionsTaken). A
 * naive JSON round-trip — what a document store like Redis does — would
 * strip every method off those fields and leave the game unusable.
 *
 * serializeGame()/deserializeGame() perform the explicit round-trip:
 *   - Deck / PotManager / Card revive through their own toJSON()/fromJSON()
 *     (JSON.stringify invokes toJSON() on nested instances automatically,
 *     so serialization only has to convert the Set explicitly).
 *   - Fields that are absent (plain test/fixture games) are left untouched,
 *     so plain records round-trip byte-identically.
 *
 * Layering: storage may depend on domain (domain only depends on config),
 * never the other way around.
 */

import { Card } from '../domain/card';
import { Deck } from '../domain/deck';
import { PotManager } from '../domain/pot-manager';
import type { GameRecord } from './memory-store';

/**
 * Prepare a game record for JSON persistence. Returns a shallow copy so
 * the caller's live object is never mutated; class instances inside the
 * copy are still live references and are converted by JSON.stringify
 * through their toJSON() methods.
 */
export function serializeGame(game: GameRecord): any {
  const out: any = { ...game };
  // Set serializes as {} by default; store it as a plain array instead.
  if (game.actionsTaken instanceof Set) {
    out.actionsTaken = Array.from(game.actionsTaken);
  }
  return out;
}

/**
 * Revive a game record after a JSON read. Class fields and the Set are
 * restored with working methods; missing fields are left as-is so plain
 * fixture records pass through unchanged.
 */
export function deserializeGame(raw: any): GameRecord {
  if (!raw || typeof raw !== 'object') return raw;
  const out: any = { ...raw };

  if (raw.deck) {
    out.deck = Deck.fromJSON(raw.deck);
  }
  if (Array.isArray(raw.communityCards)) {
    out.communityCards = raw.communityCards.map((c: any) => Card.fromJSON(c));
  }
  if (raw.pots) {
    out.pots = PotManager.fromJSON(raw.pots);
  }
  if (Array.isArray(raw.players)) {
    out.players = raw.players.map((p: any) =>
      p && Array.isArray(p.holeCards)
        ? { ...p, holeCards: p.holeCards.map((c: any) => Card.fromJSON(c)) }
        : p
    );
  }
  if ('actionsTaken' in raw) {
    // Defensive: tolerate legacy/corrupt shapes (e.g. the {} a bare Set
    // stringifies to) by reviving them as an empty Set.
    out.actionsTaken = new Set(Array.isArray(raw.actionsTaken) ? raw.actionsTaken : []);
  }
  return out;
}
