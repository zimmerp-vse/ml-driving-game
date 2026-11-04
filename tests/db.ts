// Test helper: a fresh in-process Postgres (PGlite) with the migrations applied,
// plus a minimal stand-in for what Supabase provides (roles, auth schema, extensions).

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema extensions;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  -- Supabase's default: EXECUTE on new functions in public for the API roles.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_SHIM);
  const dir = join(__dirname, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  return db;
}

/** Call a function as a given role (and optionally as a signed-in user), return the jsonb result. */
export async function call<T = any>(
  db: PGlite,
  role: 'anon' | 'authenticated' | 'service_role' | 'postgres',
  sql: string,
  params: unknown[] = [],
  userId?: string,
): Promise<T> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);`);
  if (role !== 'postgres') await db.exec(`set role ${role}`);
  try {
    const res = await db.query<{ r: T }>(`select ${sql} as r`, params);
    return res.rows[0].r;
  } finally {
    await db.exec('reset role');
  }
}
