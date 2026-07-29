/**
 * backend/routes/auth.ts - Authentication Routes
 *
 * Guest creation plus registered-user register/login. Every successful
 * response carries a server-signed JWT in `token` (guest tokens for
 * guests, user tokens for registered accounts) alongside the legacy
 * `player` field so older clients keep working during the compat window.
 */

import type { PlayerManagerService } from '../services/player-manager';

const express = require('express');
const router = express.Router();
const playerManager: PlayerManagerService = require('../services/player-manager');
const authService = require('../services/auth-service');

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72; // bcrypt truncates beyond 72 bytes

/**
 * POST /api/auth/guest
 * Create a new guest player. Socket mapping is established via Socket.IO,
 * not from a client-supplied header.
 */
router.post('/guest', async (req: any, res: any) => {
  try {
    const player = await playerManager.createGuest(null);
    res.json({
      success: true,
      player: authService.toPublicPlayer(player),
      token: authService.signToken(player.id, 'guest'),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/auth/register
 * Create a registered account and return its user token.
 */
router.post('/register', async (req: any, res: any) => {
  try {
    const body = req.body ?? {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = body.password;

    if (!USERNAME_PATTERN.test(username)) {
      return res.status(400).json({
        success: false,
        error: 'Username must be 3-20 characters (letters, numbers, underscore)',
      });
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return res.status(400).json({
        success: false,
        error: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`,
      });
    }

    const result = await playerManager.register(username, password);
    if (!result.success) {
      const status = result.code === 'USERNAME_TAKEN' ? 409 : 400;
      return res.status(status).json({ success: false, error: result.error });
    }

    res.status(201).json({
      success: true,
      player: authService.toPublicPlayer(result.player),
      token: authService.signToken(result.player.id, 'user'),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/auth/login
 * Verify credentials and return a user token. Unknown usernames and wrong
 * passwords share one generic error (and one bcrypt compare) so the
 * endpoint does not reveal which accounts exist.
 */
router.post('/login', async (req: any, res: any) => {
  try {
    const body = req.body ?? {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }

    const result = await playerManager.login(username, password);
    if (!result.success) {
      return res.status(401).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      player: authService.toPublicPlayer(result.player),
      token: authService.signToken(result.player.id, 'user'),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
