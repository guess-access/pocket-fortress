// Application records always use managed Postgres, including in Netlify Functions.
import { eq, sql } from 'drizzle-orm';
import { database } from '../db/index.mjs';
import { ledgerRecords } from '../db/schema.ts';

export async function dbGet(key) {
  const [record] = await database().select().from(ledgerRecords).where(eq(ledgerRecords.key, key));
  return record?.value ?? null;
}

export async function dbSet(key, value) {
  await database().insert(ledgerRecords).values({ key, value })
    .onConflictDoUpdate({ target: ledgerRecords.key, set: { value } });
}

export async function dbDel(key) {
  await database().delete(ledgerRecords).where(eq(ledgerRecords.key, key));
}

export async function dbList(prefix = '') {
  const records = await database().select({ key: ledgerRecords.key }).from(ledgerRecords)
    .where(sql`left(${ledgerRecords.key}, length(${prefix}::text)) = ${prefix}`);
  return records.map(({ key }) => key);
}

export function storageMode() {
  return 'database';
}
