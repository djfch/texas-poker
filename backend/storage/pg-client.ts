/**
 * backend/storage/pg-client.ts - PostgreSQL connection pool + migrations
 *
 * Thin wrapper around `pg.Pool` with a minimal hand-rolled migration
 * runner (no ORM). Migrations are plain .sql files under
 * backend/storage/migrations/, applied once each in filename order and
 * recorded in the `_migrations` bookkeeping table.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Pool, QueryResult, QueryResultRow } from 'pg';

/** Minimal pool surface the stores rely on (satisfied by pg.Pool). */
export interface PgQueryable {
  query<R extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<R>>;
}

/** Directory holding the numbered migration files. */
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export class PgClient implements PgQueryable {
  private pool: Pool;

  constructor(databaseUrl: string) {
    if (!databaseUrl) {
      throw new Error('[storage:pg] DATABASE_URL is required for the postgres backend');
    }
    // Lazy require: the pg driver must not load unless the postgres
    // backend was actually selected via STORE_BACKEND.
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString: databaseUrl });
    this.pool.on('error', (err: Error) => {
      console.error('[storage:pg] Idle pool client error:', err);
    });
  }

  async query<R extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }

  /**
   * Apply pending migrations in filename order. Each migration runs in
   * its own transaction together with its bookkeeping row, so a failed
   * statement leaves no half-applied state.
   */
  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const applied = await this.pool.query(
        'SELECT 1 FROM _migrations WHERE name = $1',
        [file]
      );
      if (applied.rowCount && applied.rowCount > 0) continue;

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[storage:pg] Applied migration ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`[storage:pg] Migration ${file} failed: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
