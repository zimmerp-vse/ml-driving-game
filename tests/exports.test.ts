// The split at release (data contract v07, section 4.4), releases, exports and live progress,
// on a small invented class.
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, call } from './db';

const ADMIN = '11111111-1111-1111-1111-111111111111';
let db: PGlite;
let studyId: string;
let code: string;
const tokens: Record<string, string> = {};

const join = async (nick: string, sex: string | null = null, age: number | null = null) => {
  const r = await call(db, 'service_role', 'public.mlg_join_study($1, $2, $3, $4, $5, 390, 844, $6)', [
    code, nick, sex, age, 'touch', 'CZ',
  ]);
  tokens[nick] = r.token;
};
const play = async (nick: string, attempt: number, outcome: string | null) => {
  await call(db, 'anon', 'public.mlg_round_start($1, $2)', [tokens[nick], attempt]);
  if (outcome === null) return; // interrupted: started, never ended
  return call(db, 'anon', 'public.mlg_round_end($1, $2, $3, 20000, $4, 0, 0, 0, $5)', [
    tokens[nick], attempt, outcome, 'Snow Valley', JSON.stringify({ sceneIndex: 7 }),
  ]);
};
const finish = (nick: string) => call(db, 'anon', 'public.mlg_finish($1)', [tokens[nick]]);
const admin = (sql: string, params: unknown[] = []) => call(db, 'authenticated', sql, params, ADMIN);
const rowsOf = (x: any) => x.files.map((r: any) => [r.file, r.player, r.attempt, r.accident]);

beforeAll(async () => {
  db = await freshDb();
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@example.com')`, [ADMIN]);
  await db.query('insert into mlgame.admins (user_id) values ($1)', [ADMIN]);
  const st = await call(db, 'authenticated',
    `public.mlg_admin_create_study('Export test', 'c', '{"test_rounds": 2, "min_rounds": 4}'::jsonb)`, [], ADMIN);
  studyId = st.id;
  code = st.code;
  await call(db, 'authenticated', `public.mlg_admin_set_status($1, 'open')`, [studyId], ADMIN);

  // anna: 7 rounds, counted 1, 3, 4, 6, 7 (5 counted, at least 4): test = 6, 7; train = 1, 3, 4. Done.
  await join('anna', 'F', 21);
  for (const [a, o] of [[1, 'delivered'], [2, 'timeout'], [3, 'crash_car'], [4, 'delivered'], [5, 'timeout'],
    [6, 'crash_pedestrian'], [7, 'delivered']] as const) await play('anna', a, o);
  await finish('anna');

  // Bob: 1 crash, 2 interrupted by a reload, 3 delivered: 2 counted (fewer than 4), all in train.
  await join('Bob', 'M');
  await play('Bob', 1, 'crash_obstacle');
  await play('Bob', 2, null);
  await play('Bob', 3, 'delivered');

  // cleo: only a timeout. dan: joined, never played.
  await join('cleo');
  await play('cleo', 1, 'timeout');
  await join('dan');
}, 30000);

describe('the split (data contract 4.4)', () => {
  it('only the admin can preview, release and export', async () => {
    for (const sql of ['public.mlg_admin_export($1)', 'public.mlg_admin_release_preview($1)', 'public.mlg_admin_list_releases($1)']) {
      await expect(call(db, 'anon', sql, [studyId])).rejects.toThrow(/permission denied/);
    }
    await expect(call(db, 'anon', 'public.mlg_admin_create_release($1, null, 2, 4)', [studyId])).rejects.toThrow(/permission denied/);
  });

  it('a preview: the last test_rounds counted rounds of players with at least min_rounds; nothing stored', async () => {
    const x = await admin('public.mlg_admin_release_preview($1)', [studyId]);
    expect(x.settings).toMatchObject({ test_rounds: 2, min_rounds: 4 });
    expect(rowsOf(x)).toEqual([
      ['train', 'anna', 1, 0],
      ['train', 'anna', 3, 1],
      ['train', 'anna', 4, 0],
      ['test', 'anna', 6, 1],
      ['test', 'anna', 7, 0],
      ['train', 'Bob', 1, 1],
      ['train', 'Bob', 3, 0],
    ]);
    // Student file rows carry only the contract's columns (no time, money, crash type...).
    expect(Object.keys(x.files[0]).sort()).toEqual([
      'accident', 'age', 'attempt', 'car_rate', 'country', 'device', 'file', 'obstacle_rate',
      'pedestrian_rate', 'player', 'round_id', 'scene', 'sex', 'trip_seconds',
    ]);
    expect(x.files[0]).toMatchObject({ sex: 'F', age: 21, device: 'touch', country: 'CZ', scene: 'Snow Valley' });
    expect(x.files[0].round_id).toMatch(/^[A-Z2-9]{8}$/);
    expect(x.counts).toEqual({
      rounds_total: 11, // anna 7, Bob 3, cleo 1
      train_rows: 5,
      test_rows: 2,
      dropped_timeout_or_breakdown: 3, // anna 2, 5; cleo 1
      dropped_unfinished: 1, // Bob 2
      dropped_after_cutoff: 0,
      players_total: 4,
      players_in_test: 1,
      players_in_train: 2,
      players_only_train: 1, // Bob
      players_left_out: 2, // cleo, dan
    });
    // Other settings: everyone with at least 2 counted rounds gets 1 test round.
    const y = await admin('public.mlg_admin_release_preview($1, null, 1, 2)', [studyId]);
    expect(y.files.filter((r: any) => r.file === 'test').map((r: any) => [r.player, r.attempt])).toEqual([['anna', 7], ['Bob', 3]]);
    await expect(admin('public.mlg_admin_release_preview($1, null, 3, 3)', [studyId])).rejects.toThrow(/invalid settings/);
    expect(await admin('public.mlg_admin_list_releases($1)', [studyId])).toEqual([]);
  });

  it('before the first release the export is the preview with the study defaults; data cannot be released yet', async () => {
    const x = await admin('public.mlg_admin_export($1)', [studyId]);
    expect(x.release).toBeNull();
    expect(rowsOf(x)).toEqual(rowsOf(await admin('public.mlg_admin_release_preview($1)', [studyId])));
    await expect(admin('public.mlg_admin_set_flags($1, true, null)', [studyId])).rejects.toThrow(/make a release first/);
  });

  it('a release is numbered, stored and released; later rounds do not change it', async () => {
    const r1 = await admin('public.mlg_admin_create_release($1, null, 2, 4)', [studyId]);
    expect(r1).toMatchObject({ number: 1, test_rounds: 2, min_rounds: 4, counts: { test_rows: 2, train_rows: 5 } });
    expect((await admin('public.mlg_admin_get_study($1)', [studyId])).data_released).toBe(true);

    // Bob plays on after the release: now 4 counted rounds.
    await play('Bob', 4, 'crash_car');
    await play('Bob', 5, 'delivered');
    const latest = await admin('public.mlg_admin_export($1)', [studyId]);
    expect(latest.release.number).toBe(1);
    expect(rowsOf(latest).filter((r: any) => r[1] === 'Bob')).toEqual([['train', 'Bob', 1, 1], ['train', 'Bob', 3, 0]]);

    // A preview with the old cutoff ignores the new rounds; a new release takes them.
    const old = await admin('public.mlg_admin_release_preview($1, $2, 2, 4)', [studyId, r1.cutoff]);
    expect(old.counts).toMatchObject({ dropped_after_cutoff: 2, test_rows: 2 });
    const r2 = await admin('public.mlg_admin_create_release($1, null, 2, 4)', [studyId]);
    expect(r2.number).toBe(2);
    const x2 = await admin('public.mlg_admin_export($1)', [studyId]);
    expect(rowsOf(x2).filter((r: any) => r[1] === 'Bob')).toEqual([
      ['train', 'Bob', 1, 1], ['train', 'Bob', 3, 0], ['test', 'Bob', 4, 1], ['test', 'Bob', 5, 0],
    ]);
    // Release 1 is still there, unchanged.
    expect(rowsOf(await admin('public.mlg_admin_export($1, 1)', [studyId]))).toEqual(rowsOf(latest));
    expect((await admin('public.mlg_admin_list_releases($1)', [studyId])).map((r: any) => r.number)).toEqual([2, 1]);
    await expect(admin('public.mlg_admin_export($1, 9)', [studyId])).rejects.toThrow(/release not found/);
  });

  it('a release needs at least one player in the test file', async () => {
    await expect(admin('public.mlg_admin_create_release($1, null, 5, 50)', [studyId])).rejects.toThrow(/no player has enough rounds/);
  });

  it('the raw export has every round with the contract section 3 columns', async () => {
    const x = await admin('public.mlg_admin_export($1)', [studyId]);
    expect(x.raw).toHaveLength(13);
    expect(Object.keys(x.raw[0]).sort()).toEqual([
      'age', 'applied', 'attempt', 'car_rate', 'counted', 'country', 'device', 'finished_at', 'joined_at',
      'money_balance', 'money_earned', 'money_lost', 'obstacle_rate', 'outcome', 'pedestrian_rate',
      'player', 'round_ended_at', 'round_started_at', 'scene', 'sex', 'study_code',
      'time_ms', 'trip_seconds', 'viewport_height', 'viewport_width',
    ]);
    expect(x.raw.find((r: any) => r.player === 'Bob' && r.attempt === 2)).toMatchObject({ outcome: null, round_ended_at: null, counted: null });
    expect(x.raw.find((r: any) => r.player === 'anna').finished_at).not.toBeNull();
    expect(x.raw.find((r: any) => r.player === 'Bob').finished_at).toBeNull();
  });
});

describe('live progress', () => {
  it('lists players with rounds, counted rounds, accidents and done; totals', async () => {
    const p = await admin('public.mlg_admin_progress($1)', [studyId]);
    const byNick = Object.fromEntries(p.players.map((x: any) => [x.nick, x]));
    expect(p.players.map((x: any) => x.nick)).toEqual(['anna', 'Bob', 'cleo', 'dan']);
    expect(p.min_rounds).toBe(4);
    expect(byNick.anna).toMatchObject({ rounds_played: 7, counted: 5, accidents: 2, done: true, playing: false });
    expect(byNick.Bob).toMatchObject({ rounds_played: 4, counted: 4, accidents: 2, done: false, playing: true });
    expect(byNick.dan).toMatchObject({ rounds_played: 0, counted: 0, done: false });
    expect(p.totals).toEqual({ joined: 4, playing: 3, enough_rounds: 2, done: 1 });
  });
});

describe('release and submission switches', () => {
  it('set and leave unchanged', async () => {
    let st = await admin('public.mlg_admin_set_flags($1, false, null)', [studyId]);
    expect([st.data_released, st.submissions_open]).toEqual([false, false]);
    st = await admin('public.mlg_admin_set_flags($1, true, true)', [studyId]);
    expect([st.data_released, st.submissions_open]).toEqual([true, true]);
    st = await admin('public.mlg_admin_set_flags($1, null, false)', [studyId]);
    expect([st.data_released, st.submissions_open]).toEqual([true, false]);
    await expect(call(db, 'anon', 'public.mlg_admin_set_flags($1, true, true)', [studyId])).rejects.toThrow(/permission denied/);
  });
});
