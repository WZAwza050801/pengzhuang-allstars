import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readRuntimeConfig } from '../config/runtime';
import { Database, MetadataRepository, migrateDatabase } from '@pengzhuang/persistence';

describe('PostgreSQL 17 persistence', () => {
  let db: Database;
  beforeAll(async () => {
    const cfg = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
    if (!cfg.databaseUrl) throw new Error('Real TEST_DATABASE_URL is required; integration tests cannot be skipped');
    db = new Database({ connectionString: cfg.databaseUrl, max: 4 });
    const result = await db.query<{ server_version_num: string }>('SHOW server_version_num');
    const version = Number(result.rows[0].server_version_num);
    expect(version).toBeGreaterThanOrEqual(170000);
    expect(version).toBeLessThan(180000);
  });
  afterAll(async () => {
    if (db) {
      await db.close();
      await db.close();
    }
  });
  test('installed migrations are idempotent when another integration suite initialized the schema first', async () => {
    await Promise.all([migrateDatabase(db), migrateDatabase(db)]);
    expect(await migrateDatabase(db)).toHaveLength(0);
  });
  test('fresh and concurrent temporary migrations apply once, then become a no-op', async () => {
    const base = process.env.PG_TEST_TMP_DIR;
    if (!base) throw new Error('Isolated migration fixture directory required');
    await mkdir(base, { recursive: true });
    const directory = await mkdtemp(path.join(base, 'concurrent-'));
    const suffix = path
      .basename(directory)
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
    const table = `migration_concurrent_${suffix}`;
    try {
      await writeFile(
        path.join(directory, '202611180010_create.mjs'),
        "export function up(pgm) { pgm.sql('CREATE TABLE migration_concurrent_probe(id int)'); }\n",
      );
      const [a, b] = await Promise.all([
        migrateDatabase(db, { directory, table }),
        migrateDatabase(db, { directory, table }),
      ]);
      expect(a.length + b.length).toBe(1);
      expect(await migrateDatabase(db, { directory, table })).toHaveLength(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test('repositories share one transaction and roll back together', async () => {
    await expect(
      db.transaction(async (tx) => {
        await new MetadataRepository(tx).set('rollback-a', { value: 1 });
        await new MetadataRepository(tx).set('rollback-b', { value: 2 });
        throw new Error('injected business failure');
      }),
    ).rejects.toThrow('injected business failure');
    expect(await new MetadataRepository(db).get('rollback-a')).toBeNull();
    expect(await new MetadataRepository(db).get('rollback-b')).toBeNull();
    await db.transaction(async (tx) => {
      await new MetadataRepository(tx).set('committed', { value: 3 });
    });
    expect((await new MetadataRepository(db).get('committed'))?.value).toEqual({ value: 3 });
  });
  test('query parameters preserve hostile strings and bigint precision', async () => {
    const key = "x'; DROP TABLE service_metadata; --";
    const repo = new MetadataRepository(db);
    await repo.set(key, { safe: true });
    expect((await repo.get(key))?.value).toEqual({ safe: true });
    const value = await db.query<{ value: string }>('SELECT $1::bigint AS value', ['9007199254740993']);
    expect(value.rows[0].value).toBe('9007199254740993');
  });
  test('failed migration batch rolls back earlier DDL', async () => {
    const base = process.env.PG_TEST_TMP_DIR;
    if (!base) throw new Error('Isolated migration fixture directory required');
    await mkdir(base, { recursive: true });
    const directory = await mkdtemp(path.join(base, 'failure-'));
    try {
      await writeFile(
        path.join(directory, '202611170010_create.mjs'),
        "export function up(pgm) { pgm.sql('CREATE TABLE migration_failure_probe(id int)'); }\n",
      );
      await writeFile(
        path.join(directory, '202611170011_fail.mjs'),
        "export function up(pgm) { pgm.sql('SELECT * FROM missing_table_arc04'); }\n",
      );
      await expect(migrateDatabase(db, { directory, table: 'migration_failure_history' })).rejects.toThrow();
      const result = await db.query<{ exists: string | null }>(
        "SELECT to_regclass('migration_failure_probe') AS exists",
      );
      expect(result.rows[0].exists).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test('down requires explicit permission; local rollback and reapply work', async () => {
    await expect(migrateDatabase(db, { direction: 'down' })).rejects.toThrow('explicit');
    expect(await migrateDatabase(db, { direction: 'down', allowRollback: true })).toHaveLength(1);
    expect(
      (
        await db.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'owned_cards' AND column_name = 'status'",
        )
      ).rows,
    ).toHaveLength(0);
    expect(await migrateDatabase(db)).toHaveLength(1);
    expect(
      (
        await db.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'owned_cards' AND column_name = 'status'",
        )
      ).rows,
    ).toHaveLength(1);
  });
});
