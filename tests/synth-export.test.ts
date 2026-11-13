// The app's release against the synthetic generator (data contract v07, sections 4 and 7).
//
// tests/fixtures/synth was written by ml/synth.py (12 players, seed 4: four players with too few
// rounds for the test, two who never said they were done, timeouts, an unfinished round). Its
// raw file is loaded into the app's tables as the app would have stored it; a release with the
// generator's cutoff and settings (mlgame.split_rows, mlg_admin_create_release, mlg_admin_export,
// src/lib/exports.ts) must then produce exactly the generator's four files, byte for byte.
// So the generator and the app apply the same rules and the same formats.
//
// Regenerate the fixture with:
//   python3 ml/synth.py --out tests/fixtures/synth --players 12 --seed 4 --intercept -2.16 --start 2026-11-02T09:15:00+00:00
//   (a start in the past: a release never takes rounds after now)
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, call } from './db';
import { buildFiles, type ExportResult } from '../src/lib/exports';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const DIR = join(__dirname, 'fixtures', 'synth');
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');

/** RFC 4180 CSV into objects (enough for the app's own files). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const SCENES = [
  'Sunset Beach', 'Mountain Pass', 'City Night', 'Desert Highway', 'Rainy Town',
  'Coastal Road', 'Autumn Forest', 'Snow Valley', 'Tropical Island', 'Volcano Road',
];
const nul = (s: string) => (s === '' ? null : s);

let db: PGlite;
let files: ReturnType<typeof buildFiles>;
let counts: ExportResult['counts'];

beforeAll(async () => {
  db = await freshDb();
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@example.com')`, [ADMIN]);
  await db.query('insert into mlgame.admins (user_id) values ($1)', [ADMIN]);
  const model = JSON.parse(read('synth_model_SYNTH1.json'));
  const st = await call(db, 'authenticated', 'public.mlg_admin_create_study($1, $2, $3::jsonb)', [
    'Synthetic class', 'c', JSON.stringify(model.params),
  ], ADMIN);
  await db.query(`update mlgame.studies set code = 'SYNTH1' where id = $1`, [st.id]);

  // round_id is not in the raw file: take it from the train and test files by (player, attempt).
  const ids = new Map<string, string>();
  for (const r of [...parseCsv(read('game_train.csv')), ...parseCsv(read('game_test.csv'))]) {
    ids.set(`${r.player}|${r.attempt}`, r.round_id);
  }
  const respondents = new Map<string, string>();
  let n = 0;
  for (const r of parseCsv(read('game_raw_SYNTH1.csv'))) {
    if (!respondents.has(r.player)) {
      const res = await db.query<{ id: string }>(
        `insert into mlgame.respondents (study_id, nick, nick_lower, sex, age, device, country,
           viewport_width, viewport_height, token_hash, joined_at, finished_at)
         values ($1, $2, lower($2), $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [st.id, r.player, nul(r.sex), nul(r.age), r.device, nul(r.country), r.viewport_width,
         r.viewport_height, `hash-${r.player}`, r.joined_at, nul(r.finished_at)],
      );
      respondents.set(r.player, res.rows[0].id);
    }
    // What the app stores as the drawn conditions; the game reports the same as `applied`.
    const conditions = r.applied ? JSON.parse(r.applied) : {
      tripDurationMs: Math.round(Number(r.trip_seconds) * 1000),
      carSpawnRate: Number(r.car_rate), obstacleSpawnRate: Number(r.obstacle_rate),
      pedestrianSpawnRate: Number(r.pedestrian_rate), sceneIndex: Math.max(0, SCENES.indexOf(r.scene)),
    };
    await db.query(
      `insert into mlgame.rounds (study_id, respondent_id, round_id, attempt, counted,
         conditions, applied, scene, outcome, time_ms, money_earned, money_lost, money_balance,
         started_at, ended_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [st.id, respondents.get(r.player), ids.get(`${r.player}|${r.attempt}`) ?? `DROP${String(++n).padStart(4, '0')}`,
       r.attempt, r.counted === '' ? null : r.counted === 'true',
       JSON.stringify(conditions), nul(r.applied), nul(r.scene), nul(r.outcome), nul(r.time_ms),
       nul(r.money_earned), nul(r.money_lost), nul(r.money_balance), r.round_started_at, nul(r.round_ended_at)],
    );
  }
  // The release, as the teacher would make it at the end of the class.
  const rel = model.release;
  await call(db, 'authenticated', 'public.mlg_admin_create_release($1, $2, $3, $4)',
    [st.id, rel.cutoff, rel.test_rounds, rel.min_rounds], ADMIN);
  const x = await call<ExportResult>(db, 'authenticated', 'public.mlg_admin_export($1)', [st.id], ADMIN);
  files = buildFiles(x);
  counts = x.counts;
}, 30000);

describe('a release of the synthetic class gives exactly the files of the generator', () => {
  for (const name of ['game_train.csv', 'game_test.csv', 'game_labels.csv', 'game_raw_SYNTH1.csv']) {
    it(name, () => {
      const got = files.find((f) => f.name === name)?.content ?? '';
      const want = read(name).split('\n');
      // Report the first differing line, which says more than two long strings.
      const k = got.split('\n').findIndex((line, n) => line !== want[n]);
      expect(k === -1 ? null : { line: k + 1, got: got.split('\n')[k], want: want[k] }).toBeNull();
    });
  }

  it('the fixture has the cases the rules are about', () => {
    expect(counts.players_total).toBe(12);
    expect(counts.players_in_test).toBe(8);
    expect(counts.players_only_train).toBe(4);
    expect(counts.dropped_timeout_or_breakdown).toBeGreaterThan(0);
    expect(counts.dropped_unfinished).toBeGreaterThan(0);
  });
});
