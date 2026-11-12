import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, call } from './db';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

let db: PGlite;
let studyId: string;
let code: string;

async function join(nick: string, extra: Partial<{ sex: string | null; age: number | null; device: string; country: string | null }> = {}) {
  return call(db, 'service_role', 'public.mlg_join_study($1, $2, $3, $4, $5, $6, $7, $8)', [
    code, nick, extra.sex ?? null, extra.age ?? null, extra.device ?? 'mouse', 1280, 720, extra.country ?? 'CZ',
  ]);
}
const roundStart = (token: string, attempt: number) =>
  call(db, 'anon', 'public.mlg_round_start($1, $2)', [token, attempt]);
const roundEnd = (token: string, attempt: number, outcome: string, timeMs = 20000) =>
  call(db, 'anon', 'public.mlg_round_end($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
    token, attempt, outcome, timeMs, 'Snow Valley', 0, 0, 1000, JSON.stringify({ sceneIndex: 7 }),
  ]);

beforeAll(async () => {
  db = await freshDb();
  await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [ADMIN, 'admin@example.com', OTHER, 'other@example.com']);
  await db.query('insert into mlgame.admins (user_id) values ($1)', [ADMIN]);
}, 30000);

describe('access control', () => {
  it('anon and authenticated cannot read the tables', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(call(db, role, '(select count(*) from mlgame.studies)')).rejects.toThrow(/permission denied/);
    }
  });

  it('anon cannot join directly (only the server can) nor call admin functions', async () => {
    await expect(call(db, 'anon', `public.mlg_join_study('X','ab',null,null,'mouse',1,1,'CZ')`)).rejects.toThrow(/permission denied/);
    await expect(call(db, 'anon', 'public.mlg_admin_list_studies()')).rejects.toThrow(/permission denied/);
    await expect(call(db, 'anon', `public.mlg_admin_create_study('t','c')`)).rejects.toThrow(/permission denied/);
  });

  it('a signed-in non-admin is refused by admin functions', async () => {
    await expect(call(db, 'authenticated', 'public.mlg_admin_list_studies()', [], OTHER)).rejects.toThrow(/not authorized/);
    expect(await call(db, 'authenticated', 'public.mlg_admin_whoami()', [], OTHER)).toEqual({ is_admin: false });
  });
});

describe('admin creates and opens a study', () => {
  it('creates a draft with default params and a 6-character code', async () => {
    const st = await call(db, 'authenticated', `public.mlg_admin_create_study('ML2 block 6', 'We store ...', '{"training_seconds": 60}'::jsonb)`, [], ADMIN);
    expect(st.status).toBe('draft');
    expect(st.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(st.params.training_seconds).toBe(60);
    expect(st.params.test_rounds).toBe(5);
    expect(st.seed).toBeUndefined();
    studyId = st.id;
    code = st.code;
  });

  it('the join page sees nothing while the study is a draft', async () => {
    expect(await call(db, 'anon', 'public.mlg_study_info($1)', [code])).toEqual({ status: 'draft' });
    expect(await join('alice')).toEqual({ ok: false, error: 'not_open' });
  });

  it('opens it', async () => {
    const st = await call(db, 'authenticated', `public.mlg_admin_set_status($1, 'open')`, [studyId], ADMIN);
    expect(st.status).toBe('open');
    const info = await call(db, 'anon', 'public.mlg_study_info($1)', [code.toLowerCase()]);
    expect(info).toMatchObject({ status: 'open', title: 'ML2 block 6' });
  });
});

describe('join', () => {
  it('joins, stores the token hashed, normalises the country', async () => {
    const r = await join('  Alice  ', { sex: 'F', age: 21, country: 'cz' });
    expect(r.ok).toBe(true);
    expect(r.nick).toBe('Alice');
    expect(r.token).toMatch(/^[0-9a-f]{64}$/);
    const row = (await db.query<any>('select * from mlgame.respondents where id = $1', [r.respondent_id])).rows[0];
    expect(row.nick).toBe('Alice');
    expect(row.country).toBe('CZ');
    expect(row.token_hash).not.toBe(r.token);
  });

  it('refuses a taken nick (case-insensitive), bad input; unknown country is stored as missing', async () => {
    expect(await join('ALICE')).toEqual({ ok: false, error: 'nick_taken' });
    expect(await join('a')).toEqual({ ok: false, error: 'invalid_nick' });
    expect(await join('bob', { sex: 'X' })).toEqual({ ok: false, error: 'invalid_input' });
    expect(await join('bob', { age: 12 })).toEqual({ ok: false, error: 'invalid_input' });
    const r = await join('bob', { country: 'XX', device: 'touch' });
    expect(r.ok).toBe(true);
    const row = (await db.query<any>('select country, sex, age, device from mlgame.respondents where id = $1', [r.respondent_id])).rows[0];
    expect(row).toEqual({ country: null, sex: null, age: null, device: 'touch' });
  });
});

describe('schedule and phases', () => {
  let token: string;

  it('draws a schedule within the ranges, reproducibly', async () => {
    token = (await join('carol')).token;
    const s = await call(db, 'anon', 'public.mlg_start_schedule($1, 80)', [token]);
    expect(s).toMatchObject({ ok: true, from_attempt: 1, next_attempt: 1, done: false, fixed: { malfunctionProbability: 0, deliveryDistance: 200 } });
    expect(s.rounds).toHaveLength(80);
    for (const c of s.rounds) {
      expect(c.tripDurationMs).toBeGreaterThanOrEqual(13000);
      expect(c.tripDurationMs).toBeLessThanOrEqual(33000);
      expect(c.carSpawnRate).toBeGreaterThanOrEqual(0.01);
      expect(c.carSpawnRate).toBeLessThanOrEqual(0.09);
      expect(c.sceneIndex).toBeGreaterThanOrEqual(0);
      expect(c.sceneIndex).toBeLessThanOrEqual(9);
    }
    expect(new Set(s.rounds.map((c: any) => c.sceneIndex)).size).toBeGreaterThan(5);
    const again = await call(db, 'anon', 'public.mlg_start_schedule($1, 80)', [token]);
    expect(again.rounds).toEqual(s.rounds);
  });

  it('training rounds, then 5 counted test rounds; timeouts in the test are replaced', async () => {
    // Two training rounds.
    await roundStart(token, 1);
    expect(await roundEnd(token, 1, 'delivered')).toMatchObject({ ok: true, done: false });
    await roundStart(token, 2);
    await roundEnd(token, 2, 'crash_car');
    // Round 2 is repeated (a duplicate message): nothing changes.
    await roundEnd(token, 2, 'delivered');

    // Training time (60 s) runs out: move the first start back in time.
    await db.query(`update mlgame.respondents set first_round_started_at = now() - interval '2 minutes' where nick = 'carol'`);

    const outcomes = ['delivered', 'timeout', 'crash_obstacle', 'malfunction', 'delivered', 'crash_pedestrian', 'delivered'];
    let last: any;
    for (let i = 0; i < outcomes.length; i++) {
      const attempt = 3 + i;
      await roundStart(token, attempt);
      last = await roundEnd(token, attempt, outcomes[i]);
    }
    expect(last).toMatchObject({ ok: true, done: true, counted_test_rounds: 5 });

    const rows = (await db.query<any>(
      `select attempt, phase, counted, test_index, outcome, conditions, scene from mlgame.rounds r
         join mlgame.respondents p on p.id = r.respondent_id where p.nick = 'carol' order by attempt`)).rows;
    expect(rows.map((r: any) => [r.attempt, r.phase, r.counted, r.test_index])).toEqual([
      [1, 'train', true, null],
      [2, 'train', true, null],
      [3, 'test', true, 1],
      [4, 'test', false, null],
      [5, 'test', true, 2],
      [6, 'test', false, null],
      [7, 'test', true, 3],
      [8, 'test', true, 4],
      [9, 'test', true, 5],
    ]);
    expect(rows[1].outcome).toBe('crash_car');

    const s = await call(db, 'anon', 'public.mlg_resume($1)', [token]);
    expect(s).toMatchObject({ ok: true, done: true, next_attempt: 10 });
  });

  it('a resume continues after the last started round, with the same draws', async () => {
    const t = (await join('dave')).token;
    const first = await call(db, 'anon', 'public.mlg_start_schedule($1, 10)', [t]);
    await roundStart(t, 1);
    await roundEnd(t, 1, 'delivered');
    await roundStart(t, 2); // interrupted by a reload: never ends
    const resumed = await call(db, 'anon', 'public.mlg_start_schedule($1, 10)', [t]);
    expect(resumed.from_attempt).toBe(3);
    expect(resumed.rounds.slice(0, 8)).toEqual(first.rounds.slice(2, 10));
  });

  it('round_end without round_start still records the round', async () => {
    const t = (await join('erin')).token;
    expect(await roundEnd(t, 1, 'delivered', 30000)).toMatchObject({ ok: true });
    const row = (await db.query<any>(
      `select phase, started_at, ended_at from mlgame.rounds r join mlgame.respondents p on p.id = r.respondent_id where p.nick = 'erin'`)).rows[0];
    expect(row.phase).toBe('train');
    expect(new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()).toBeGreaterThan(29000);
  });

  it('max_training_rounds ends training early', async () => {
    const st = await call(db, 'authenticated',
      `public.mlg_admin_create_study('capped', 'c', '{"max_training_rounds": 2, "test_rounds": 1}'::jsonb)`, [], ADMIN);
    await call(db, 'authenticated', `public.mlg_admin_set_status($1, 'open')`, [st.id], ADMIN);
    const r = await call(db, 'service_role', `public.mlg_join_study($1, 'frank', null, null, 'mouse', 1, 1, null)`, [st.code]);
    for (const a of [1, 2]) {
      await roundStart(r.token, a);
      expect((await roundEnd(r.token, a, 'delivered')).done).toBe(false);
    }
    await roundStart(r.token, 3);
    expect((await roundEnd(r.token, 3, 'crash_car')).done).toBe(true);
  });

  it('bad input and unknown tokens are refused', async () => {
    expect(await roundEnd(token, 0, 'delivered')).toEqual({ ok: false, error: 'invalid_input' });
    expect(await roundEnd(token, 1, 'flying')).toEqual({ ok: false, error: 'invalid_input' });
    expect(await call(db, 'anon', 'public.mlg_resume($1)', ['nope'])).toEqual({ ok: false, error: 'unknown_token' });
    expect(await call(db, 'anon', 'public.mlg_round_start($1, 1)', ['nope'])).toEqual({ ok: false, error: 'unknown_token' });
  });

  it('the projector page gets counts only, no personal data', async () => {
    const info = await call(db, 'anon', 'public.mlg_screen_info($1)', [code]);
    // carol is done; alice, bob, dave, erin joined and were active just now.
    expect(info).toEqual({ status: 'open', title: 'ML2 block 6', joined: 5, playing: 4, done: 1 });
    await db.query(`update mlgame.respondents set last_activity_at = now() - interval '10 minutes' where nick = 'bob'`);
    expect((await call(db, 'anon', 'public.mlg_screen_info($1)', [code])).playing).toBe(3);
    expect(await call(db, 'anon', 'public.mlg_screen_info($1)', ['NOPE99'])).toEqual({ status: 'not_found' });
  });

  it('the admin can let players join again; the join page sees the setting', async () => {
    expect((await call(db, 'anon', 'public.mlg_study_info($1)', [code])).allow_rejoin).toBe(false);
    await expect(call(db, 'anon', 'public.mlg_admin_set_allow_rejoin($1, true)', [studyId])).rejects.toThrow(/permission denied/);
    await expect(call(db, 'authenticated', 'public.mlg_admin_set_allow_rejoin($1, true)', [studyId], OTHER)).rejects.toThrow(/not authorized/);
    const st = await call(db, 'authenticated', 'public.mlg_admin_set_allow_rejoin($1, true)', [studyId], ADMIN);
    expect(st.allow_rejoin).toBe(true);
    expect((await call(db, 'anon', 'public.mlg_study_info($1)', [code])).allow_rejoin).toBe(true);
    const list = await call(db, 'authenticated', 'public.mlg_admin_list_studies()', [], ADMIN);
    expect(list.find((s: any) => s.id === studyId).allow_rejoin).toBe(true);
    // Replacing functions kept their grants: anon still cannot list studies.
    await expect(call(db, 'anon', 'public.mlg_admin_list_studies()')).rejects.toThrow(/permission denied/);
  });

  it('with Replay on, a taken nick gets a suffix that fits 20 characters; with Replay off it is refused', async () => {
    const a = await join('ALICE');
    expect(a).toMatchObject({ ok: true, nick: 'ALICE_2' });
    expect(await join('alice')).toMatchObject({ ok: true, nick: 'alice_3' });
    await join('Twenty characters ok');
    expect(await join('twenty characters ok')).toMatchObject({ ok: true, nick: 'twenty characters_2' });
    const row = (await db.query<any>('select nick, nick_lower from mlgame.respondents where id = $1', [a.respondent_id])).rows[0];
    expect(row).toEqual({ nick: 'ALICE_2', nick_lower: 'alice_2' });
    await call(db, 'authenticated', 'public.mlg_admin_set_allow_rejoin($1, false)', [studyId], ADMIN);
    expect(await join('Alice')).toEqual({ ok: false, error: 'nick_taken' });
    await db.query(`delete from mlgame.respondents where nick_lower in ('alice_2', 'alice_3', 'twenty characters ok', 'twenty characters_2')`);
  });

  it('new studies get the defaults of contract v06 (shorter rounds, v01 spawn rates)', async () => {
    const st = await call(db, 'authenticated', `public.mlg_admin_create_study('defaults', 'c')`, [], ADMIN);
    expect(st.params.fixed).toEqual({ malfunctionProbability: 0, deliveryDistance: 200 });
    expect(st.params.ranges.trip_seconds).toEqual({ min: 13, max: 33, scale: 'linear' });
    expect(st.params.ranges.car_rate).toEqual({ min: 0.01, max: 0.09, scale: 'linear' });
    expect(st.params.ranges.obstacle_rate).toEqual({ min: 0.002, max: 0.015, scale: 'linear' });
    expect(st.params.ranges.pedestrian_rate).toEqual({ min: 0.001, max: 0.010, scale: 'linear' });
    await call(db, 'authenticated', `public.mlg_admin_set_status($1, 'open')`, [st.id], ADMIN);
    const r = await call(db, 'service_role', `public.mlg_join_study($1, 'shorty', null, null, 'mouse', 1, 1, null)`, [st.code]);
    const s = await call(db, 'anon', 'public.mlg_start_schedule($1, 50)', [r.token]);
    expect(s.fixed.deliveryDistance).toBe(200);
    for (const c of s.rounds) {
      expect(c.tripDurationMs).toBeGreaterThanOrEqual(13000);
      expect(c.tripDurationMs).toBeLessThanOrEqual(33000);
    }
  });

  it('deleting a study: admin only, code needed once players exist, removes everything', async () => {
    const empty = await call(db, 'authenticated', `public.mlg_admin_create_study('empty', 'c')`, [], ADMIN);
    await expect(call(db, 'anon', 'public.mlg_admin_delete_study($1)', [empty.id])).rejects.toThrow(/permission denied/);
    await expect(call(db, 'authenticated', 'public.mlg_admin_delete_study($1)', [empty.id], OTHER)).rejects.toThrow(/not authorized/);
    expect(await call(db, 'authenticated', 'public.mlg_admin_delete_study($1)', [empty.id], ADMIN)).toEqual({ deleted: true, players: 0 });

    const full = await call(db, 'authenticated', `public.mlg_admin_create_study('full', 'c')`, [], ADMIN);
    await call(db, 'authenticated', `public.mlg_admin_set_status($1, 'open')`, [full.id], ADMIN);
    const r = await call(db, 'service_role', `public.mlg_join_study($1, 'gone', null, null, 'mouse', 1, 1, null)`, [full.code]);
    await roundStart(r.token, 1);
    await roundEnd(r.token, 1, 'delivered');
    expect(await call(db, 'authenticated', `public.mlg_admin_delete_study($1, 'WRONG')`, [full.id], ADMIN))
      .toEqual({ deleted: false, error: 'confirm_code', players: 1 });
    expect(await call(db, 'authenticated', 'public.mlg_admin_delete_study($1, $2)', [full.id, full.code.toLowerCase()], ADMIN))
      .toEqual({ deleted: true, players: 1 });
    const left = (await db.query<any>(
      `select (select count(*) from mlgame.respondents where study_id = $1)::int as p,
              (select count(*) from mlgame.rounds where study_id = $1)::int as r,
              (select count(*) from mlgame.studies where id = $1)::int as s`, [full.id])).rows[0];
    expect(left).toEqual({ p: 0, r: 0, s: 0 });
  });

  it('closing a study stops rounds and joins', async () => {
    await call(db, 'authenticated', `public.mlg_admin_set_status($1, 'closed')`, [studyId], ADMIN);
    expect(await join('gina')).toEqual({ ok: false, error: 'not_open' });
    const list = await call(db, 'authenticated', 'public.mlg_admin_list_studies()', [], ADMIN);
    expect(list.find((s: any) => s.id === studyId)).toMatchObject({ status: 'closed', joined: 5 });
  });
});
