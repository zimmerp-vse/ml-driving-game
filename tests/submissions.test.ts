// Students' files, team submissions (data contract section 5) and reports storage.
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, call } from './db';

const ADMIN = '11111111-1111-1111-1111-111111111111';
let db: PGlite;
let studyId: string;
let code: string;
let testIds: string[] = [];

const admin = (sql: string, params: unknown[] = []) => call(db, 'authenticated', sql, params, ADMIN);
const submit = (team: string, pin: string, rows: unknown) =>
  call(db, 'anon', 'public.mlg_submit($1, $2, $3, $4)', [code, team, pin, JSON.stringify(rows)]);
const codes = (r: any) => r.messages.map((m: any) => m.code);
const good = () => testIds.map((id, i) => ({ round_id: id, p: 0.2 + 0.1 * i }));

beforeAll(async () => {
  db = await freshDb();
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@example.com')`, [ADMIN]);
  await db.query('insert into mlgame.admins (user_id) values ($1)', [ADMIN]);
  const st = await admin(`public.mlg_admin_create_study('Sub test', 'c', '{"test_rounds": 2, "min_rounds": 3}'::jsonb)`);
  studyId = st.id;
  code = st.code;
  await admin(`public.mlg_admin_set_status($1, 'open')`, [studyId]);
  // One player with 4 counted rounds: at release, 2 training rounds and the last 2 as the test.
  const t = (await call(db, 'service_role', `public.mlg_join_study($1, 'anna', 'F', 20, 'touch', 1, 1, 'CZ')`, [code])).token;
  const play = async (a: number, o: string) => {
    await call(db, 'anon', 'public.mlg_round_start($1, $2)', [t, a]);
    await call(db, 'anon', `public.mlg_round_end($1, $2, $3, 1000, 'x', 0, 0, 0, null)`, [t, a, o]);
  };
  await play(1, 'delivered');
  await play(2, 'crash_car');
  await play(3, 'crash_obstacle');
  await play(4, 'delivered');
}, 30000);

describe('the submission page', () => {
  it('shows no data before release, then train with and test without the target', async () => {
    const before = await call(db, 'anon', 'public.mlg_submit_page($1)', [code]);
    expect(before).toEqual({ status: 'open', title: 'Sub test', data_released: false, submissions_open: false });
    await admin('public.mlg_admin_create_release($1, null, 2, 3)', [studyId]);
    const x = await admin('public.mlg_admin_export($1)', [studyId]);
    testIds = x.files.filter((r: any) => r.file === 'test').map((r: any) => r.round_id);
    const after = await call(db, 'anon', 'public.mlg_submit_page($1)', [code]);
    expect(after).toMatchObject({ data_released: true, release: { number: 1 } });
    expect(after.train).toHaveLength(2);
    expect(after.train[0].accident).toBe(0);
    expect(after.test).toHaveLength(2);
    expect(after.test[0]).not.toHaveProperty('accident');
    expect(after.test.map((r: any) => r.round_id)).toEqual(testIds);
  });
});

describe('submit', () => {
  it('is refused while submissions are closed', async () => {
    expect(codes(await submit('Team A', '1234', good()))).toEqual(['closed']);
  });

  it('accepts a good file and sets the PIN with the first upload; never returns a score', async () => {
    await admin('public.mlg_admin_set_flags($1, null, true)', [studyId]);
    const r = await submit('Team A', '1234', good());
    expect(r).toEqual({ accepted: true, release: 1, messages: [{ level: 'info', code: 'pin_set' }] });
  });

  it('needs the same PIN later; the team name is case-insensitive', async () => {
    expect(codes(await submit('team a', '9999', good()))).toEqual(['wrong_pin']);
    expect(await submit('  TEAM   A ', '1234', good())).toEqual({ accepted: true, release: 1, messages: [] });
  });

  it('rejects files that do not match game_test.csv, with codes the page can explain', async () => {
    const [a, b] = testIds;
    let r = await submit('B', '0000', [{ round_id: a, p: 0.3 }]);
    expect(r.accepted).toBe(false);
    expect(r.messages[0]).toMatchObject({ code: 'missing_ids', n: 1, examples: [b] });

    r = await submit('B', '0000', [...good(), { round_id: 'NOTANID1', p: 0.5 }]);
    expect(codes(r)).toEqual(['unknown_ids']);

    r = await submit('B', '0000', [...good(), { round_id: a, p: 0.5 }]);
    expect(codes(r)).toEqual(['duplicates']);

    r = await submit('B', '0000', [{ round_id: a, p: 1.5 }, { round_id: b, p: 'x' }]);
    expect(r.messages[0]).toMatchObject({ code: 'p_out_of_range', n: 2 });
  });

  it('rejects labels; accepts exact 0 or 1 with a warning', async () => {
    const [a, b] = testIds;
    expect(codes(await submit('B', '0000', [{ round_id: a, p: 0 }, { round_id: b, p: 1 }]))).toEqual(['looks_like_labels']);
    const r = await submit('B', '0000', [{ round_id: a, p: 0 }, { round_id: b, p: 0.4 }]);
    expect(r.accepted).toBe(true);
    expect(r.messages).toEqual([{ level: 'warning', code: 'zero_or_one', n: 1 }]);
  });

  it('bad team name or PIN format', async () => {
    expect(codes(await submit('', '1234', good()))).toEqual(['bad_team']);
    expect(codes(await submit('C', '12a4', good()))).toEqual(['bad_pin']);
  });

  it('at most 20 uploads per team per hour', async () => {
    for (let i = 0; i < 20; i++) await submit('Spam', '1111', good());
    expect(codes(await submit('Spam', '1111', good()))).toEqual(['too_many']);
  });
});

describe('report data and stored reports', () => {
  it('lists uploads without wrong-PIN attempts and gives each team its last accepted file', async () => {
    const d = await admin('public.mlg_admin_report_data($1)', [studyId]);
    expect(d.uploads.some((u: any) => u.messages.some((m: any) => m.code === 'wrong_pin'))).toBe(false);
    const byTeam = Object.fromEntries(d.last_accepted.map((x: any) => [x.team.toLowerCase(), x]));
    expect(Object.keys(byTeam).sort()).toEqual(['b', 'spam', 'team a']);
    // Team B's last accepted file is the one with p = 0 for the first round.
    expect(byTeam.b.rows.find((r: any) => r.round_id === testIds[0]).p).toBe(0);
    expect(d.files).toBeDefined();
    expect(d.study_full.params.test_rounds).toBe(2);
  });

  it('saves, lists and returns reports; admin only', async () => {
    const { id } = await admin(`public.mlg_admin_save_report($1, 'running', '<html>r</html>')`, [studyId]);
    const list = await admin('public.mlg_admin_list_reports($1)', [studyId]);
    expect(list[0]).toMatchObject({ id, kind: 'running', size: 14 });
    expect(await admin('public.mlg_admin_get_report($1)', [id])).toBe('<html>r</html>');
    await expect(call(db, 'anon', 'public.mlg_admin_get_report($1)', [id])).rejects.toThrow(/permission denied/);
    await expect(call(db, 'anon', 'public.mlg_admin_report_data($1)', [studyId])).rejects.toThrow(/permission denied/);
  });

  it('a new release: uploads are checked against it, and reports score the uploads of their release', async () => {
    await admin('public.mlg_admin_create_release($1, null, 1, 2)', [studyId]);
    const page = await call(db, 'anon', 'public.mlg_submit_page($1)', [code]);
    expect(page.release.number).toBe(2);
    expect(page.test.map((r: any) => r.round_id)).toEqual([testIds[1]]);
    // Release 1's file no longer fits.
    expect(codes(await submit('Team A', '1234', good()))).toEqual(['unknown_ids']);
    const latest = await admin('public.mlg_admin_report_data($1)', [studyId]);
    expect(latest.release.number).toBe(2);
    expect(latest.last_accepted).toEqual([]);
    expect(new Set(latest.uploads.map((u: any) => u.release))).toEqual(new Set([1, 2]));
    const ok = await submit('Team A', '1234', [{ round_id: testIds[1], p: 0.3 }]);
    expect(ok).toMatchObject({ accepted: true, release: 2 });
    expect((await admin('public.mlg_admin_report_data($1)', [studyId])).last_accepted.map((x: any) => x.team)).toEqual(['Team A']);
    // Release 1's report still has its own uploads.
    expect((await admin('public.mlg_admin_report_data($1, 1)', [studyId])).last_accepted).toHaveLength(3);
  });

  it('closing the study closes submissions', async () => {
    await admin(`public.mlg_admin_set_status($1, 'closed')`, [studyId]);
    expect(codes(await submit('Team A', '1234', good()))).toEqual(['closed']);
  });
});
