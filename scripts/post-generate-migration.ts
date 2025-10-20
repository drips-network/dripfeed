import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Post-processes Drizzle-generated migrations to make them schema-agnostic.
 * Removes hardcoded "public". schema prefix from CREATE TYPE statements.
 */
async function postProcessMigrations(): Promise<void> {
  const migrationsDir = join(__dirname, '..', 'src', 'db', 'migrations');
  const files = await readdir(migrationsDir);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

  if (sqlFiles.length === 0) {
    console.log('No migration files found.');
    return;
  }

  // Process only the most recent migration.
  const latestFile = sqlFiles[sqlFiles.length - 1]!;
  const filePath = join(migrationsDir, latestFile);

  let content = await readFile(filePath, 'utf-8');
  const originalContent = content;

  // Remove "public". prefix from CREATE TYPE statements.
  content = content.replace(/CREATE TYPE "public"\."(\w+)"/g, 'CREATE TYPE $1');

  // Remove "public". prefix from REFERENCES clauses.
  content = content.replace(/REFERENCES "public"\."(\w+)"/g, 'REFERENCES "$1"');

  if (content !== originalContent) {
    await writeFile(filePath, content, 'utf-8');
    console.log(`✓ Post-processed ${latestFile}: removed schema prefixes from enums`);
  } else {
    console.log(`✓ No changes needed for ${latestFile}`);
  }
}

postProcessMigrations().catch((error) => {
  console.error('Failed to post-process migrations:', error);
  process.exit(1);
});
