-- 0001_init.sql - Initial schema for the postgres storage backend
--
-- users: registered accounts AND guest player profiles (PlayerRecord).
--   Fixed columns mirror the account-facing PlayerRecord fields; all
--   remaining dynamic fields (isGuest, isOnline, socketId, currentRoom,
--   lastLoginAt, lastActive, ...) live in the `data` JSONB column and are
--   merged back on read. Epoch timestamps are stored as BIGINT毫秒 to stay
--   type-identical with the in-memory PlayerRecord shape.
--
-- hand_history: one row per player per settled hand (written at showdown).

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT,
  password_hash TEXT,
  nickname      TEXT,
  avatar        TEXT,
  chips         BIGINT NOT NULL DEFAULT 0,
  created_at    BIGINT NOT NULL,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Case-insensitive username uniqueness without the citext extension.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uidx
  ON users (lower(username))
  WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS hand_history (
  id             BIGSERIAL PRIMARY KEY,
  room_id        TEXT NOT NULL,
  game_id        TEXT NOT NULL,
  player_id      TEXT NOT NULL,
  nickname       TEXT,
  hole_cards     JSONB,
  hand_name      TEXT,
  delta          BIGINT NOT NULL DEFAULT 0,
  starting_chips BIGINT NOT NULL DEFAULT 0,
  final_chips    BIGINT NOT NULL DEFAULT 0,
  is_winner      BOOLEAN NOT NULL DEFAULT FALSE,
  summary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS hand_history_player_idx ON hand_history (player_id);
CREATE INDEX IF NOT EXISTS hand_history_room_idx ON hand_history (room_id);
