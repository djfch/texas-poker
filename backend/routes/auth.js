/**
 * backend/routes/auth.js - Authentication Routes
 *
 * Guest player creation (no real auth for simplicity)
 */

const express = require('express');
const router = express.Router();
const playerManager = require('../services/player-manager');

/**
 * POST /api/auth/guest
 * Create a new guest player. Socket mapping is established via Socket.IO,
 * not from a client-supplied header.
 */
router.post('/guest', async (req, res) => {
  try {
    const player = await playerManager.createGuest(null);
    res.json({
      success: true,
      player: {
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        chips: player.chips,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/auth/register
 * Placeholder for registration
 */
router.post('/register', (req, res) => {
  res.status(501).json({ success: false, error: 'Registration not implemented' });
});

/**
 * POST /api/auth/login
 * Placeholder for login
 */
router.post('/login', (req, res) => {
  res.status(501).json({ success: false, error: 'Login not implemented' });
});

module.exports = router;
