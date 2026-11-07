import { pgTable, text, jsonb } from 'drizzle-orm/pg-core';

// Preserve the existing API record format while moving persistence to Postgres.
export const ledgerRecords = pgTable('ledger_records', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});
