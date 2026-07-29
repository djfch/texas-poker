/**
 * backend/storage/postgres-store.test.ts - PostgresStore unit tests
 *
 * Pure-logic tests against a fake PgStoreClient (no real database):
 * SQL shapes, users row <-> PlayerRecord mapping, hand history inserts,
 * lazy one-shot migration, and the runtime-state delegation to the
 * composed in-memory store.
 */

const test = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');

const { PostgresStore } = require('./postgres-store');

/** Fake queryable: a users table map + a hand_history row list. */
class FakePg {
  users = new Map<string, any>();
  handHistory: any[] = [];
  queries: string[] = [];
  migrateCalls = 0;

  async migrate() {
    this.migrateCalls++;
  }

  async query(text: string, params: any[] = []) {
    this.queries.push(text);

    if (text.startsWith('INSERT INTO users')) {
      this.users.set(params[0], {
        id: params[0],
        username: params[1],
        password_hash: params[2],
        nickname: params[3],
        avatar: params[4],
        chips: params[5],
        created_at: params[6],
        data: params[7],
      });
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('UPDATE users')) {
      const row = this.users.get(params[0]);
      if (row) {
        Object.assign(row, {
          username: params[1],
          password_hash: params[2],
          nickname: params[3],
          avatar: params[4],
          chips: params[5],
          created_at: params[6],
          data: params[7],
        });
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith('DELETE FROM users')) {
      const removed = this.users.delete(params[0]);
      return { rows: [], rowCount: removed ? 1 : 0 };
    }
    if (text.includes('SELECT 1 AS x FROM users WHERE id')) {
      const found = this.users.has(params[0]);
      return { rows: found ? [{ x: 1 }] : [], rowCount: found ? 1 : 0 };
    }
    if (text.includes('FROM users WHERE id')) {
      const row = this.users.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (text.includes('FROM users')) {
      return { rows: [...this.users.values()], rowCount: this.users.size };
    }
    if (text.startsWith('INSERT INTO hand_history')) {
      this.handHistory.push({
        room_id: params[0],
        game_id: params[1],
        player_id: params[2],
        nickname: params[3],
        hole_cards: params[4] ? JSON.parse(params[4]) : null,
        hand_name: params[5],
        delta: params[6],
        starting_chips: params[7],
        final_chips: params[8],
        is_winner: params[9],
        summary: params[10],
        created_at: params[11],
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`FakePg: unexpected SQL: ${text}`);
  }
}

function makeStore() {
  const fake = new FakePg();
  const store = new PostgresStore({ client: fake });
  return { store, fake };
}

test('createPlayer inserts fixed columns and packs dynamic fields into data JSONB', async () => {
  const { store, fake } = makeStore();
  await store.createPlayer({
    id: 'u1',
    username: 'Alice',
    passwordHash: 'hash-1',
    nickname: 'Alice',
    avatar: '#abc',
    chips: 1000,
    createdAt: 1234567890,
    isGuest: false,
    currentRoom: null,
    lastActive: 42,
  });

  const row = fake.users.get('u1');
  assert.equal(row.username, 'Alice');
  assert.equal(row.password_hash, 'hash-1');
  assert.equal(row.chips, 1000);
  assert.equal(row.created_at, 1234567890);
  assert.deepEqual(row.data, { isGuest: false, currentRoom: null, lastActive: 42 });
  assert.ok(fake.queries.some(q => q.startsWith('INSERT INTO users')));
});

test('getPlayer merges the data JSONB back into the PlayerRecord', async () => {
  const { store } = makeStore();
  await store.createPlayer({
    id: 'u1',
    username: 'bob',
    nickname: 'Bob',
    avatar: '#111',
    chips: 500,
    createdAt: 1000,
    isGuest: false,
    currentRoom: 'ROOM9',
  });

  const player = await store.getPlayer('u1');
  assert.equal(player.id, 'u1');
  assert.equal(player.username, 'bob');
  assert.equal(player.chips, 500);
  assert.equal(player.createdAt, 1000);
  assert.equal(player.currentRoom, 'ROOM9');
  assert.equal(player.isGuest, false);

  assert.equal(await store.getPlayer('missing'), null);
  await assert.rejects(
    () => store.createPlayer({ id: 'u1', nickname: 'dupe' }),
    /Player already exists: u1/
  );
});

test('updatePlayer rewrites the row with merged fields; missing players return null', async () => {
  const { store, fake } = makeStore();
  await store.createPlayer({ id: 'u1', nickname: 'Old', avatar: '#1', chips: 100, createdAt: 5 });

  const merged = await store.updatePlayer('u1', { chips: 750, lastActive: 99 });
  assert.equal(merged.chips, 750);
  assert.equal(merged.nickname, 'Old');
  assert.equal(fake.users.get('u1').chips, 750);
  assert.equal(fake.users.get('u1').data.lastActive, 99);
  assert.ok(fake.queries.some(q => q.startsWith('UPDATE users')));

  assert.equal(await store.updatePlayer('missing', { chips: 1 }), null);
});

test('socket links sync socketId/isOnline into the SQL row', async () => {
  const { store } = makeStore();
  await store.createPlayer({ id: 'u1', nickname: 'Sock', chips: 0, createdAt: 1 });

  await store.linkSocket('s1', 'u1');
  let player = await store.getPlayer('u1');
  assert.equal(player.socketId, 's1');
  assert.equal(player.isOnline, true);
  assert.equal(await store.getPlayerIdBySocket('s1'), 'u1');
  assert.equal((await store.getPlayerBySocket('s1')).id, 'u1');

  await store.unlinkSocket('s1');
  player = await store.getPlayer('u1');
  assert.equal(player.socketId, null);
  assert.equal(player.isOnline, false);
});

test('deletePlayer removes the SQL row and socket links', async () => {
  const { store, fake } = makeStore();
  await store.createPlayer({ id: 'u1', nickname: 'Gone', chips: 0, createdAt: 1 });
  await store.linkSocket('s1', 'u1');

  await store.deletePlayer('u1');
  assert.equal(fake.users.has('u1'), false);
  assert.equal(await store.getPlayerIdBySocket('s1'), null);
});

test('rooms/games stay in the composed memory runtime and never touch SQL', async () => {
  const { store, fake } = makeStore();
  const queriesBefore = fake.queries.length;

  await store.createRoom({ id: 'r1', status: 'waiting', players: [], createdAt: Date.now() });
  await store.createGame({ roomId: 'r1', status: 'preflop' });

  assert.equal((await store.getRoom('r1')).status, 'waiting');
  assert.equal((await store.getGame('r1')).status, 'preflop');
  assert.equal((await store.listRooms({ status: 'waiting' })).length, 1);

  // player-manager reads store.rooms directly (nickname fan-out path)
  assert.ok(store.rooms.has('r1'));

  // Zero SQL was issued for runtime state (no migrate, no room queries)
  assert.equal(fake.queries.length, queriesBefore);
  assert.equal(fake.migrateCalls, 0);
});

test('saveHandHistory inserts one mapped row into hand_history', async () => {
  const { store, fake } = makeStore();
  await store.saveHandHistory({
    roomId: 'r1',
    gameId: 'r1',
    playerId: 'u1',
    nickname: 'Alice',
    holeCards: ['A♥', 'K♦'],
    handName: '一对',
    delta: 120,
    startingChips: 1000,
    finalChips: 1120,
    isWinner: true,
    summary: { seatPosition: 0, folded: false, communityCards: ['2♣'], totalPot: 120 },
    createdAt: 777,
  });

  assert.equal(fake.handHistory.length, 1);
  const row = fake.handHistory[0];
  assert.equal(row.room_id, 'r1');
  assert.equal(row.player_id, 'u1');
  assert.deepEqual(row.hole_cards, ['A♥', 'K♦']);
  assert.equal(row.hand_name, '一对');
  assert.equal(row.delta, 120);
  assert.equal(row.is_winner, true);
  assert.equal(row.summary.totalPot, 120);
  assert.equal(row.created_at, 777);
});

test('migrations run lazily and exactly once across SQL operations', async () => {
  const { store, fake } = makeStore();
  assert.equal(fake.migrateCalls, 0);

  await store.createPlayer({ id: 'u1', nickname: 'A', chips: 0, createdAt: 1 });
  await store.getPlayer('u1');
  await store.listPlayers();
  await store.saveHandHistory({
    roomId: 'r1', gameId: 'r1', playerId: 'u1', holeCards: null, handName: null,
    delta: 0, startingChips: 0, finalChips: 0, isWinner: false, summary: {}, createdAt: 1,
  });

  assert.equal(fake.migrateCalls, 1);
});

// File-local module scope: keeps top-level declarations out of the global scope.
export {};
