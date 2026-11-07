import { drizzle } from 'drizzle-orm/netlify-db';
import * as schema from './schema.ts';

let client;
export function database() {
  client ??= drizzle({ schema });
  return client;
}
