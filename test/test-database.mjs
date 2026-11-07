import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readdir, readFile } from 'node:fs/promises';
import * as schema from '../db/schema.ts';

// Test-only Postgres engine; production always uses Netlify Database.
export const testDatabase = new PGlite();
const migrations = new URL('../netlify/database/migrations/', import.meta.url);
for (const entry of (await readdir(migrations)).sort()) {
  const file = entry.endsWith('.sql') ? entry : `${entry}/migration.sql`;
  await testDatabase.exec(await readFile(new URL(file, migrations), 'utf8'));
}
const client = drizzle({ client: testDatabase, schema });
export function database() {
  return client;
}
