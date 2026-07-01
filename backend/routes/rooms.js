/**
 * backend/routes/rooms.js - Room Management Routes
 *
 * Room CRUD and listing endpoints.
 */

const express = require('express');
const router = express.Router();
const roomManager = require('../services/room-manager');
const playerManager = require('../services/player-manager');

const MAX_NAME_LENGTH = 50;

function sanitizeConfig(body) {
  const config = {
    name: typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LENGTH) : undefined,
    maxPlayers: body.maxPlayers,
    smallBlind: body.smallBlind,
    bigBlind: body.bigBlind,
    initialChips: body.initialChips,
    allowAI: body.allowAI,
    isPrivate: body.isPrivate,
    password: body.password,
  };
  // Remove undefined keys so room-manager defaults take effect
  Object.keys(config).forEach(key => {
    if (config[key] === undefined) delete config[key];
  });
  return config;
}

/**
 * GET /api/rooms
 * List all public waiting rooms
 */
router.get('/', async (req, res) => {
  try {
    const rooms = await roomManager.listPublicRooms();
    res.json({ success: true, rooms });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/rooms
 * Create a new room
 */
router.post('/', async (req, res) => {
  try {
    const playerId = req.headers['x-player-id'];
    if (!playerId) {
      return res.status(401).json({ success: false, error: 'Player ID required' });
    }

    const player = await playerManager.getPlayerById(playerId);
    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }

    const config = sanitizeConfig(req.body);
    const room = await roomManager.createRoom(playerId, config);
    res.json({ success: true, room });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/rooms/:roomId
 * Get room details
 */
router.get('/:roomId', async (req, res) => {
  try {
    const room = await roomManager.getRoom(req.params.roomId);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    res.json({
      success: true,
      room: roomManager._sanitizeRoom(room),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/rooms/:roomId/join
 * Join a room
 */
router.post('/:roomId/join', async (req, res) => {
  try {
    const playerId = req.headers['x-player-id'];
    if (!playerId) {
      return res.status(401).json({ success: false, error: 'Player ID required' });
    }

    const result = await roomManager.joinRoom(req.params.roomId, playerId, req.body.password);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
