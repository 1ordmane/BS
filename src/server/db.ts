import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { paths } from './config.ts';
import { migrations } from './migrations.ts';

/**
 * One SQLite connection per process. SQLite serialises writes, WAL mode lets readers
 * continue during a write, and every multi-step change runs inside tx().
 */

let connection: DatabaseSync | null = null;
let connectionPath = '';
let depth = 0;

export function getDb(): DatabaseSync {
  const file = paths.db();
  if (connection && connectionPath === file) return connection;
  closeDb();

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  migrate(db, file);
  connection = db;
  connectionPath = file;
  return db;
}

export function closeDb(): void {
  if (connection) connection.close();
  connection = null;
  connectionPath = '';
  depth = 0;
}

export function schemaVersion(db: DatabaseSync = getDb()): number {
  return Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
}

function migrate(db: DatabaseSync, file: string): void {
  const current = schemaVersion(db);
  if (current > migrations.length) {
    throw new Error(`Database schema ${current} is newer than this code (${migrations.length}). Update the application.`);
  }
  if (current === migrations.length) return;

  // Keep a copy of an existing database before changing its schema.
  if (current > 0) {
    const copy = `${file}.before-migration-${current + 1}-${Date.now()}`;
    db.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
  }

  for (let version = current; version < migrations.length; version += 1) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migrations[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** Runs fn in a transaction (a savepoint when nested). Throwing rolls everything back. */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  const savepoint = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  depth += 1;
  try {
    const result = fn();
    depth -= 1;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    depth -= 1;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw error;
  }
}

export function now(): string {
  return new Date().toISOString();
}

type Row = Record<string, unknown>;

export function one<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as T | undefined;
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[];
}

export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
  const result = getDb().prepare(sql).run(...(params as never[]));
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

export function logActivity(userId: number | null, action: string, summary: string): void {
  run('INSERT INTO activity (at, user_id, action, summary) VALUES (?, ?, ?, ?)', now(), userId, action, summary);
  run('DELETE FROM activity WHERE id <= (SELECT id FROM activity ORDER BY id DESC LIMIT 1 OFFSET 500)');
}
