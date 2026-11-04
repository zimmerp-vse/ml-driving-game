// Local stand-in for Supabase's RPC endpoint, for development and end-to-end tests
// without a real project. Runs the migrations in an in-process Postgres (PGlite) and
// answers POST /rest/v1/rpc/<function> like PostgREST does (named arguments).
//
//   npm run mock-db          # listens on http://localhost:54321
//
// Role: requests whose apikey starts with "sb_secret_" run as service_role, all
// others as anon. Admin functions are not supported here; a study is created and
// opened at start-up and its code printed.

import { createServer } from 'node:http';
import { freshDb, call } from './db';

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const db = await freshDb();

// MOCK_PARAMS overrides study parameters, e.g. '{"training_seconds": 60}'.
await db.query(
  `insert into mlgame.studies (code, title, consent_text, status, params)
   values ('TEST01', 'Driving study (local test)',
           'We store your nick, sex, age, device and country. Local test only.',
           'open', mlgame.default_params() || $1::jsonb)`,
  [process.env.MOCK_PARAMS ?? '{"training_seconds": 60}'],
);

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end();
    return;
  }
  if (req.method === 'GET' && req.url === '/debug/rounds') {
    // Local inspection only: what the server stored per round.
    const r = await db.query(
      `select p.nick, p.device, p.country, r.attempt, r.phase, r.counted, r.test_index, r.outcome,
              r.conditions, r.applied, r.scene, r.started_at, r.ended_at
         from mlgame.rounds r join mlgame.respondents p on p.id = r.respondent_id
        order by p.nick, r.attempt`,
    );
    res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(r.rows, null, 1));
    return;
  }
  const m = req.url?.match(/^\/rest\/v1\/rpc\/(mlg_[a-z_]+)$/);
  if (req.method !== 'POST' || !m) {
    res.writeHead(404, cors).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const args = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>;
  const names = Object.keys(args);
  const role = String(req.headers.apikey ?? '').startsWith('sb_secret_') ? 'service_role' : 'anon';
  const sql = `public.${m[1]}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
  const values = names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n]));
  try {
    const result = await call(db, role, sql, values);
    res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(400, { ...cors, 'content-type': 'application/json' })
      .end(JSON.stringify({ code: 'P0001', message: (e as Error).message }));
  }
}).listen(PORT, () => {
  console.log(`mock Supabase on http://localhost:${PORT}; open study code TEST01`);
});

// Expose the database for inspection in tests (vite-node keeps the process alive).
(globalThis as Record<string, unknown>).__mockDb = db;
