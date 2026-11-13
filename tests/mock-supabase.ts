// Local stand-in for Supabase, for development and end-to-end tests without a real project.
// Runs the migrations in an in-process Postgres (PGlite) and answers:
//   POST /rest/v1/rpc/<mlg_function>   like PostgREST (named arguments)
//   POST /auth/v1/token, GET /auth/v1/user, POST /auth/v1/logout   a minimal password sign-in
//
//   npm run mock-db          # listens on http://localhost:54321
//
// Roles: apikey "sb_secret_..." runs as service_role; a request with a session from this mock
// runs as authenticated (that user); everything else as anon.
// Local test admin (this mock only, never a real account): MOCK_ADMIN_EMAIL / MOCK_ADMIN_PASSWORD
// below. A study TEST01 is created and opened at start-up.

import { createServer, type IncomingMessage } from 'node:http';
import { freshDb, call } from './db';

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const MOCK_ADMIN_ID = '00000000-0000-4000-8000-00000000ad31';
const MOCK_ADMIN_EMAIL = 'admin@local.test';
const MOCK_ADMIN_PASSWORD = 'local-test-only';

const db = await freshDb();
await db.query(`insert into auth.users (id, email) values ($1, $2)`, [MOCK_ADMIN_ID, MOCK_ADMIN_EMAIL]);
await db.query(`insert into mlgame.admins (user_id) values ($1)`, [MOCK_ADMIN_ID]);

// MOCK_PARAMS overrides study parameters, e.g. '{"min_rounds": 4}'.
await db.query(
  `insert into mlgame.studies (code, title, consent_text, status, params)
   values ('TEST01', 'Driving study (local test)',
           'We store your nick, sex, age, device and country. Local test only.',
           'open', mlgame.default_params() || $1::jsonb)`,
  [process.env.MOCK_PARAMS ?? '{}'],
);
// The local test study lets a finished player join again (see migration 20261105100000).
await db.query(`update mlgame.studies set allow_rejoin = true where code = 'TEST01'`);

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

// An unsigned JWT-shaped token: enough for supabase-js, recognised only by this mock.
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: MOCK_ADMIN_ID, aud: 'authenticated', role: 'authenticated', email: MOCK_ADMIN_EMAIL,
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString(),
  };
  const access_token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: MOCK_ADMIN_ID, role: 'authenticated', aud: 'authenticated', email: MOCK_ADMIN_EMAIL, exp })}.mock`;
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'mock-refresh', user };
}
function userFromAuthHeader(req: IncomingMessage): string | null {
  const m = String(req.headers.authorization ?? '').match(/^Bearer (.+)\.(.+)\.mock$/);
  if (!m) return null;
  try {
    const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
    return claims.exp > Date.now() / 1000 ? claims.sub : null;
  } catch {
    return null;
  }
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
const json = (res: import('node:http').ServerResponse, status: number, data: unknown) =>
  res.writeHead(status, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(data));

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();

  // --- minimal auth ---
  if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
    const b = await body(req);
    if (url.searchParams.get('grant_type') === 'refresh_token' || (b.email === MOCK_ADMIN_EMAIL && b.password === MOCK_ADMIN_PASSWORD)) {
      return json(res, 200, session());
    }
    return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
  }
  if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
    return userFromAuthHeader(req) ? json(res, 200, session().user) : json(res, 401, { msg: 'not signed in' });
  }
  if (url.pathname === '/auth/v1/logout') return void res.writeHead(204, cors).end();

  if (req.method === 'GET' && url.pathname === '/debug/rounds') {
    // Local inspection only: what the server stored per round.
    const r = await db.query(
      `select st.code as study_code, p.nick, p.device, p.country, r.attempt, r.counted,
              r.outcome, r.conditions, r.applied, r.scene, r.started_at, r.ended_at
         from mlgame.rounds r join mlgame.respondents p on p.id = r.respondent_id
         join mlgame.studies st on st.id = r.study_id
        order by st.code, p.nick, r.attempt`,
    );
    return json(res, 200, r.rows);
  }

  // --- RPC ---
  const m = url.pathname.match(/^\/rest\/v1\/rpc\/(mlg_[a-z_]+)$/);
  if (req.method !== 'POST' || !m) return void res.writeHead(404, cors).end();
  const args = await body(req);
  const names = Object.keys(args);
  const userId = userFromAuthHeader(req);
  const role = String(req.headers.apikey ?? '').startsWith('sb_secret_') ? 'service_role' : userId ? 'authenticated' : 'anon';
  const sql = `public.${m[1]}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
  const values = names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n]));
  try {
    json(res, 200, await call(db, role, sql, values, userId ?? undefined));
  } catch (e) {
    json(res, 400, { code: 'P0001', message: (e as Error).message });
  }
}).listen(PORT, () => {
  console.log(`mock Supabase on http://localhost:${PORT}; open study code TEST01`);
});
