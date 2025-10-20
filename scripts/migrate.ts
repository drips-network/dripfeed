import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import type { Pool } from 'pg';
import { Pool as PgPool } from 'pg';

import { config } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type Migration = {
  name: string;
  sql: string;
};

async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = await readdir(dir);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

  const migrations: Migration[] = [];
  for (const file of sqlFiles) {
    const sql = await readFile(join(dir, file), 'utf-8');
    migrations.push({ name: file, sql });
  }

  return migrations;
}

async function ensureMigrationsTable(pool: Pool, schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${schema}._migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );
}

async function getAppliedMigrations(pool: Pool, schema: string): Promise<Set<string>> {
  const result = await pool.query<{ name: string }>(`SELECT name FROM ${schema}._migrations`);
  return new Set(result.rows.map((r) => r.name));
}

async function applyMigration(pool: Pool, schema: string, migration: Migration): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET search_path TO ${schema}`);
    await client.query(migration.sql);
    await client.query(`INSERT INTO ${schema}._migrations (name) VALUES ($1)`, [migration.name]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function runMigrations(pool: Pool, schema: string, migrationsDir: string): Promise<void> {
  await ensureMigrationsTable(pool, schema);
  const applied = await getAppliedMigrations(pool, schema);
  const migrations = await loadMigrations(migrationsDir);

  console.log(`Found ${migrations.length} migration(s):`);
  migrations.forEach((m) => console.log(`  - ${m.name}`));

  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      console.log(`Skipping migration: ${migration.name}`);
      continue;
    }

    await applyMigration(pool, schema, migration);
    console.log(`✅ Applied migration: ${migration.name}`);
  }

  console.log('🎉 All migrations complete!');
}

async function main(): Promise<void> {
  const pool = new PgPool({ connectionString: config.database.url });

  try {
    const migrationsDir = join(__dirname, '..', 'src', 'db', 'migrations');
    await runMigrations(pool, config.database.schema, migrationsDir);

    console.log('Success');
  } catch (error) {
    console.error('Failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
