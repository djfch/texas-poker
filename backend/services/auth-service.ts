/**
 * backend/services/auth-service.ts - JWT issuing/verification + password hashing
 *
 * Single entry point for token resolution across REST and Socket.IO:
 * - Guests and registered users both get server-signed JWTs; the payload
 *   carries { playerId, type } so the server stays authoritative about
 *   which player a connection belongs to.
 * - Passwords are hashed with bcrypt (pure JS). A lazily-built dummy hash
 *   lets the login path perform a real compare for unknown usernames,
 *   keeping the timing side channel closed.
 * - The secret comes from JWT_SECRET; outside production a clearly labeled
 *   dev fallback is used, while production refuses to boot without one.
 */

import type { PlayerRecord } from '../storage/memory-store';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { JWT_SECRET, JWT_EXPIRES_IN, NODE_ENV } = require('../config/constants');

const BCRYPT_ROUNDS = 10;
const DEV_FALLBACK_SECRET = 'dev-only-insecure-jwt-secret-change-me';

const SECRET: string = JWT_SECRET || (NODE_ENV === 'production' ? '' : DEV_FALLBACK_SECRET);
if (!SECRET) {
  throw new Error('[Auth] JWT_SECRET must be explicitly configured in production');
}

export type TokenType = 'guest' | 'user';

export interface AuthTokenPayload {
  playerId: string;
  type: TokenType;
}

/** Result of resolving a request's identity. */
export type ResolvedIdentity =
  | { playerId: string; error?: never }
  | { playerId: null; error?: string };

/**
 * Sign a token for a player. `expiresIn` is injectable for tests.
 */
function signToken(playerId: string, type: TokenType, expiresIn: string = JWT_EXPIRES_IN): string {
  return jwt.sign({ playerId, type }, SECRET, { expiresIn });
}

/**
 * Verify a token and return its payload, or null when the token is
 * missing, malformed, expired, or signed with a different secret.
 */
function verifyToken(token: unknown): AuthTokenPayload | null {
  if (typeof token !== 'string' || !token) return null;
  try {
    const decoded = jwt.verify(token, SECRET);
    if (typeof decoded?.playerId !== 'string' || !decoded.playerId) return null;
    if (decoded.type !== 'guest' && decoded.type !== 'user') return null;
    return { playerId: decoded.playerId, type: decoded.type };
  } catch {
    return null;
  }
}

/** Hash a plaintext password for storage. */
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Compare a plaintext password against a stored hash. */
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Built on first use so startup cost stays zero when nobody logs in.
let dummyHashPromise: Promise<string> | null = null;

/**
 * A real bcrypt hash of a constant, used by the login path to run a
 * genuine compare when the username does not exist (timing-attack guard).
 */
function dummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    // bcryptjs is untyped via require(); the cast keeps the narrowing exact.
    dummyHashPromise = bcrypt.hash('timing-dummy-password', BCRYPT_ROUNDS) as Promise<string>;
  }
  return dummyHashPromise;
}

/**
 * Resolve the player identity of an HTTP request.
 * Priority: Authorization: Bearer <jwt> (authoritative) > x-player-id
 * header (legacy compatibility window). An invalid Bearer token is an
 * explicit error - we never silently fall back past a bad token.
 */
function resolveRequestIdentity(req: any): ResolvedIdentity {
  const header = req?.headers?.['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const payload = verifyToken(header.slice('Bearer '.length).trim());
    if (!payload) return { playerId: null, error: 'Invalid or expired token' };
    return { playerId: payload.playerId };
  }

  const legacyId = req?.headers?.['x-player-id'];
  if (typeof legacyId === 'string' && legacyId) {
    return { playerId: legacyId };
  }
  return { playerId: null };
}

/** Shape of a player record safe to send to clients (no credentials). */
function toPublicPlayer(player: PlayerRecord): { id: string; nickname: string; avatar: string; chips: number } {
  return {
    id: player.id,
    nickname: player.nickname,
    avatar: player.avatar,
    chips: player.chips,
  };
}

module.exports = {
  signToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  dummyPasswordHash,
  resolveRequestIdentity,
  toPublicPlayer,
};
