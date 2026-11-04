// The file rules of data contract section 4.4 and the live progress, on a small invented class.
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
// Training time runs out for this player: rounds started from now on are test rounds.
const endTraining = (nick: string) =>
  db.query(`update mlgame.respondents set first_round_started_at = now() - interval '2 minutes' where nick = $1`, [nick]);

beforeAll(async () => {
  db = await freshDb();
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@example.com')`, [ADMIN]);
  await db.query('insert into mlgame.admins (user_id) values ($1)', [ADMIN]);
  const st = await call(db, 'authenticated',
    `public.mlg_admin_create_study('Export test', 'c', '{"training_seconds": 60, "test_rounds": 2}'::jsonb)`, [], ADMIN);
  studyId = st.id;
  code = st.code;
  await call(db, 'authenticated', `public.mlg_admin_set_status($1, 'open')`, [studyId], ADMIN);

  // anna: complete. Training 1 delivered, 2 timeout, 3 crash; test 4 delivered, 5 timeout, 6 crash.
  await join('anna', 'F', 21);
  await play('anna', 1, 'delivered');
  await play('anna', 2, 'timeout');
  await play('anna', 3, 'crash_car');
  await endTraining('anna');
  await play('anna', 4, 'delivered');
  await play('anna', 5, 'timeout');
  await play('anna', 6, 'crash_pedestrian');

  // Bob: incomplete. Training 1 crash, 2 interrupted by a reload; test 3 delivered (1 of 2).
  await join('Bob', 'M');
  await play('Bob', 1, 'crash_obstacle');
  await play('Bob', 2, null);
  await endTraining('Bob');
  await play('Bob', 3, 'delivered');

  // cleo: no counted training round. Training 1 timeout; test 2 crash, 3 delivered (complete).
  await join('cleo');
  await play('cleo', 1, 'timeout');
  await endTraining('cleo');
  await play('cleo', 2, 'crash_car');
  await play('cleo', 3, 'delivered');

  // dan: joined, never played.
  await join('dan');
}, 30000);

describe('exports (data contract 4.4)', () => {
  it('only the admin can export', async () => {
    await expect(call(db, 'anon', 'public.mlg_admin_export($1)', [studyId])).rejects.toThrow(/permission denied/);
  });

  it('builds the train and test rows by the rules, sorted by player then attempt', async () => {
    const x = await call(db, 'authenticated', 'public.mlg_admin_export($1)', [studyId], ADMIN);
    const rows = x.files.map((r: any) => [r.file, r.player, r.attempt, r.accident]);
    expect(rows).toEqual([
      ['train', 'anna', 1, 0],
      ['train', 'anna', 3, 1],
      ['test', 'anna', 4, 0],
      ['test', 'anna', 6, 1],
      ['train', 'Bob', 1, 1],
      ['train', 'Bob', 3, 0], // incomplete: the test round goes to train
    ]);
    // Student file rows carry only the contract's columns (no time, money, phase, crash type...).
    expect(Object.keys(x.files[0]).sort()).toEqual([
      'accident', 'age', 'attempt', 'car_rate', 'country', 'device', 'file', 'obstacle_rate',
      'pedestrian_rate', 'player', 'round_id', 'scene', 'sex', 'trip_seconds',
    ]);
    const a1 = x.files[0];
    expect(a1).toMatchObject({ sex: 'F', age: 21, device: 'touch', country: 'CZ', scene: 'Snow Valley' });
    expect(a1.round_id).toMatch(/^[A-Z2-9]{8}$/);
    expect(a1.trip_seconds).toBeGreaterThanOrEqual(13);
    expect(a1.trip_seconds).toBeLessThanOrEqual(33);
  });

  it('counts what the rules dropped', async () => {
    const x = await call(db, 'authenticated', 'public.mlg_admin_export($1)', [studyId], ADMIN);
    expect(x.counts).toEqual({
      rounds_total: 12, // anna 6, Bob 3, cleo 3
      train_rows: 4,
      test_rows: 2,
      dropped_timeout_or_breakdown: 3, // anna 2, anna 5, cleo 1
      dropped_interrupted: 1, // Bob 2
      dropped_no_training_round: 2, // cleo 2, 3
      dropped_after_done: 0,
      players_total: 4,
      players_complete: 1,
      players_in_train: 2,
      players_left_out: 2, // cleo, dan
    });
  });

  it('the raw export has every round (12) with the contract section 3 columns', async () => {
    const x = await call(db, 'authenticated', 'public.mlg_admin_export($1)', [studyId], ADMIN);
    expect(x.raw).toHaveLength(12);
    expect(Object.keys(x.raw[0]).sort()).toEqual([
      'age', 'applied', 'attempt', 'car_rate', 'counted', 'country', 'device', 'joined_at',
      'money_balance', 'money_earned', 'money_lost', 'obstacle_rate', 'outcome', 'pedestrian_rate',
      'phase', 'player', 'round_ended_at', 'round_started_at', 'scene', 'sex', 'study_code',
      'test_index', 'time_ms', 'trip_seconds', 'viewport_height', 'viewport_width',
    ]);
    const interrupted = x.raw.find((r: any) => r.player === 'Bob' && r.attempt === 2);
    expect(interrupted).toMatchObject({ outcome: null, round_ended_at: null, phase: null });
  });
});

describe('live progress', () => {
  it('lists players with phase, rounds and accidents, and totals', async () => {
    const p = await call(db, 'authenticated', 'public.mlg_admin_progress($1)', [studyId], ADMIN);
    const byNick = Object.fromEntries(p.players.map((x: any) => [x.nick, x]));
    expect(p.players.map((x: any) => x.nick)).toEqual(['anna', 'Bob', 'cleo', 'dan']);
    expect(byNick.anna).toMatchObject({ phase: 'done', rounds_played: 6, accidents: 2, counted_test_rounds: 2, playing: false });
    expect(byNick.Bob).toMatchObject({ phase: 'test', rounds_played: 2, accidents: 1, counted_test_rounds: 1, playing: true });
    expect(byNick.cleo.phase).toBe('done');
    expect(byNick.dan).toMatchObject({ phase: 'not started', rounds_played: 0 });
    expect(p.totals).toEqual({ joined: 4, playing: 2, in_test: 1, done: 2 });
  });
});

describe('release and submission switches', () => {
  it('set and leave unchanged', async () => {
    let st = await call(db, 'authenticated', 'public.mlg_admin_set_flags($1, true, null)', [studyId], ADMIN);
    expect([st.data_released, st.submissions_open]).toEqual([true, false]);
    st = await call(db, 'authenticated', 'public.mlg_admin_set_flags($1, null, true)', [studyId], ADMIN);
    expect([st.data_released, st.submissions_open]).toEqual([true, true]);
    await expect(call(db, 'anon', 'public.mlg_admin_set_flags($1, true, true)', [studyId])).rejects.toThrow(/permission denied/);
  });
});
