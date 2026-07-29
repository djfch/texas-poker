/**
 * backend/storage/storage-contract.test.ts - Storage contract suite
 *
 * Parameterized behavioral contract for every Storage implementation.
 * The memory backend always runs. The postgres/redis backends run the
 * same suite only when DATABASE_URL / REDIS_URL are set (e.g. CI with
 * services); otherwise an explicit skipped test marks them as not run.
 *
 * NOTE (local): PostgreSQL/Redis runs are unverified on this machine
 * (no Docker); they are expected to run in CI / deployment environments.
 */

const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { randomUUID } = require('crypto');

import type { Storage } from './memory-store';

type StoreFactory = () => Storage;

/** Register the full contract suite against one backend. */
function contractTests(label: string, makeStore: StoreFactory): void {
  const uid = () => randomUUID();

  test(`[${label}] player create/get/update/delete round-trips fields`, async () => {
    const store = makeStore();
    const id = uid();
    const created = await store.createPlayer({
      id,
      nickname: 'Contract Player',
      avatar: '#fff',
      chips: 1500,
      isGuest: false,
      currentRoom: null,
      customField: 'kept',
    });
    assert.equal(created.id, id);

    const fetched = await store.getPlayer(id);
    assert.ok(fetched);
    assert.equal(fetched.nickname, 'Contract Player');
    assert.equal(fetched.chips, 1500);
    assert.equal(fetched.customField, 'kept');

    const updated = await store.updatePlayer(id, { chips: 900, nickname: 'Renamed' });
    assert.ok(updated);
    assert.equal(updated.chips, 900);
    assert.equal((await store.getPlayer(id))!.nickname, 'Renamed');

    await store.deletePlayer(id);
    assert.equal(await store.getPlayer(id), null);
    assert.equal(await store.updatePlayer(id, { chips: 1 }), null);
  });

  test(`[${label}] createPlayer rejects missing id and duplicates`, async () => {
    const store = makeStore();
    await assert.rejects(() => store.createPlayer({} as any), /Player must have an id/);
    const id = uid();
    await store.createPlayer({ id, nickname: 'first' });
    await assert.rejects(() => store.createPlayer({ id, nickname: 'second' }), /Player already exists/);
    await store.deletePlayer(id);
  });

  test(`[${label}] listPlayers contains created players`, async () => {
    const store = makeStore();
    const id = uid();
    await store.createPlayer({ id, nickname: 'Listed' });
    const all = await store.listPlayers();
    assert.ok(all.some(p => p.id === id && p.nickname === 'Listed'));
    await store.deletePlayer(id);
  });

  test(`[${label}] socket links resolve both directions and sync player fields`, async () => {
    const store = makeStore();
    const id = uid();
    await store.createPlayer({ id, nickname: 'Sock', socketId: null, isOnline: false });

    await store.linkSocket('sock-1', id);
    assert.equal(await store.getPlayerIdBySocket('sock-1'), id);
    assert.equal(await store.getSocketByPlayerId(id), 'sock-1');
    assert.equal((await store.getPlayerBySocket('sock-1'))!.id, id);
    const linked = await store.getPlayer(id);
    assert.equal(linked!.socketId, 'sock-1');
    assert.equal(linked!.isOnline, true);

    // Re-linking replaces the old socket (memory-store semantics)
    await store.linkSocket('sock-2', id);
    assert.equal(await store.getPlayerIdBySocket('sock-1'), null);
    assert.equal(await store.getSocketByPlayerId(id), 'sock-2');

    await store.unlinkSocket('sock-2');
    assert.equal(await store.getPlayerIdBySocket('sock-2'), null);
    assert.equal(await store.getSocketByPlayerId(id), null);
    const unlinked = await store.getPlayer(id);
    assert.equal(unlinked!.socketId, null);
    assert.equal(unlinked!.isOnline, false);

    await store.deletePlayer(id);
  });

  test(`[${label}] deletePlayer clears socket links`, async () => {
    const store = makeStore();
    const id = uid();
    await store.createPlayer({ id, nickname: 'Gone' });
    await store.linkSocket('sock-x', id);
    await store.deletePlayer(id);
    assert.equal(await store.getPlayerIdBySocket('sock-x'), null);
    assert.equal(await store.getSocketByPlayerId(id), null);
  });

  test(`[${label}] room CRUD works and deleteRoom also removes the game`, async () => {
    const store = makeStore();
    const id = uid();
    await store.createRoom({ id, name: 'Room', status: 'waiting', isPrivate: false, players: [], createdAt: Date.now() });
    assert.equal((await store.getRoom(id))!.name, 'Room');

    const updated = await store.updateRoom(id, { status: 'playing' });
    assert.equal(updated!.status, 'playing');
    assert.equal((await store.getRoom(id))!.status, 'playing');

    await store.createGame({ roomId: id, status: 'preflop' });
    assert.ok(await store.getGame(id));

    await store.deleteRoom(id);
    assert.equal(await store.getRoom(id), null);
    assert.equal(await store.getGame(id), null);
    assert.equal(await store.updateRoom(id, { status: 'x' }), null);
  });

  test(`[${label}] createRoom rejects missing id and duplicates`, async () => {
    const store = makeStore();
    await assert.rejects(() => store.createRoom({} as any), /Room must have an id/);
    const id = uid();
    await store.createRoom({ id, players: [] });
    await assert.rejects(() => store.createRoom({ id, players: [] }), /Room already exists/);
    await store.deleteRoom(id);
  });

  test(`[${label}] listRooms filters by status and isPublic`, async () => {
    const store = makeStore();
    const waitingPublic = uid();
    const waitingPrivate = uid();
    const playingPublic = uid();
    await store.createRoom({ id: waitingPublic, status: 'waiting', isPrivate: false, players: [] });
    await store.createRoom({ id: waitingPrivate, status: 'waiting', isPrivate: true, players: [] });
    await store.createRoom({ id: playingPublic, status: 'playing', isPrivate: false, players: [] });

    const waitingIds = (await store.listRooms({ status: 'waiting' })).map(r => r.id);
    assert.ok(waitingIds.includes(waitingPublic));
    assert.ok(waitingIds.includes(waitingPrivate));
    assert.ok(!waitingIds.includes(playingPublic));

    const publicIds = (await store.listRooms({ isPublic: true })).map(r => r.id);
    assert.ok(publicIds.includes(waitingPublic));
    assert.ok(!publicIds.includes(waitingPrivate));

    const both = (await store.listRooms({ status: 'waiting', isPublic: true })).map(r => r.id);
    assert.ok(both.includes(waitingPublic));
    assert.ok(!both.includes(waitingPrivate));

    await store.deleteRoom(waitingPublic);
    await store.deleteRoom(waitingPrivate);
    await store.deleteRoom(playingPublic);
  });

  test(`[${label}] game CRUD is keyed by roomId and createGame overwrites`, async () => {
    const store = makeStore();
    const roomId = uid();
    await assert.rejects(() => store.createGame({} as any), /Game must have a roomId/);

    await store.createGame({ roomId, status: 'preflop', pot: 100 });
    await store.createGame({ roomId, status: 'flop', pot: 250 });
    const game = await store.getGame(roomId);
    assert.equal(game!.status, 'flop');
    assert.equal(game!.pot, 250);

    const updated = await store.updateGame(roomId, { status: 'river' });
    assert.equal(updated!.status, 'river');

    await store.deleteGame(roomId);
    assert.equal(await store.getGame(roomId), null);
    assert.equal(await store.updateGame(roomId, { status: 'x' }), null);
  });

  test(`[${label}] cleanup removes stale empty rooms only`, async () => {
    const store = makeStore();
    const stale = uid();
    const fresh = uid();
    const occupied = uid();
    await store.createRoom({ id: stale, players: [], createdAt: Date.now() - 2 * 3600000 });
    await store.createRoom({ id: fresh, players: [], createdAt: Date.now() });
    await store.createRoom({ id: occupied, players: [{ playerId: 'p1' }], createdAt: Date.now() - 2 * 3600000 });

    await store.cleanup();

    assert.equal(await store.getRoom(stale), null);
    assert.ok(await store.getRoom(fresh));
    assert.ok(await store.getRoom(occupied));

    await store.deleteRoom(fresh);
    await store.deleteRoom(occupied);
  });
}

// ─── Backend registrations ─────────────────────────────────────────

contractTests('memory', () => require('./memory-store'));

if (process.env.DATABASE_URL) {
  const { PostgresStore } = require('./postgres-store');
  const pgStore: Storage & { close?: () => Promise<void> } = new PostgresStore({ url: process.env.DATABASE_URL });
  contractTests('postgres', () => pgStore);
  test.after(() => pgStore.close && pgStore.close());
} else {
  test('[postgres] storage contract', { skip: 'DATABASE_URL not set' }, () => {});
}

if (process.env.REDIS_URL) {
  const { RedisStore } = require('./redis-store');
  const redisStore: Storage & { close?: () => Promise<void> } = new RedisStore({ url: process.env.REDIS_URL });
  contractTests('redis', () => redisStore);
  test.after(() => redisStore.close && redisStore.close());
} else {
  test('[redis] storage contract', { skip: 'REDIS_URL not set' }, () => {});
}
