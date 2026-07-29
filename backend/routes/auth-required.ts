/**
 * backend/routes/auth-required.ts - REST Authentication Middleware
 *
 * Resolves the caller's player identity for protected endpoints.
 * Resolution order (see auth-service): Authorization Bearer JWT first,
 * then the legacy x-player-id header during the compatibility window.
 * On success `req.playerId` is set; the route stays responsible for
 * loading/authorizing the player record itself.
 */

const authService = require('../services/auth-service');

async function authRequired(req: any, res: any, next: any): Promise<void> {
  const resolved = authService.resolveRequestIdentity(req);
  if (resolved.error) {
    res.status(401).json({ success: false, error: resolved.error });
    return;
  }
  if (!resolved.playerId) {
    res.status(401).json({ success: false, error: 'Player ID required' });
    return;
  }
  req.playerId = resolved.playerId;
  next();
}

module.exports = { authRequired };

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
