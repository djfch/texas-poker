/**
 * backend/routes/rooms.ts - Room Management Routes
 *
 * Room CRUD and listing endpoints.
 */

import type { RoomManagerService } from '../services/room-manager';
import type { PlayerManagerService } from '../services/player-manager';

const express = require('express');
const router = express.Router();
const roomManager: RoomManagerService = require('../services/room-manager');
const playerManager: PlayerManagerService = require('../services/player-manager');
const { authRequired } = require('./auth-required');

const MAX_NAME_LENGTH = 50;

function sanitizeConfig(body: any): Record<string, any> {
  const config: Record<string, any> = {
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
router.get('/', async (req: any, res: any) => {
  try {
    const rooms = await roomManager.listPublicRooms();
    res.json({ success: true, rooms });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/rooms
 * Create a new room
 */
router.post('/', authRequired, async (req: any, res: any) => {
  try {
    const playerId = req.playerId;

    const player = await playerManager.getPlayerById(playerId);
    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }

    const config = sanitizeConfig(req.body);
    const room = await roomManager.createRoom(playerId, config);
    res.json({ success: true, room });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/rooms/:roomId
 * Get room details
 */
router.get('/:roomId', async (req: any, res: any) => {
  try {
    const room = await roomManager.getRoom(req.params.roomId);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    res.json({
      success: true,
      room: roomManager._sanitizeRoom(room),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/rooms/:roomId/join
 * Join a room
 */
router.post('/:roomId/join', authRequired, async (req: any, res: any) => {
  try {
    const playerId = req.playerId;

    const result = await roomManager.joinRoom(req.params.roomId, playerId, req.body.password);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
