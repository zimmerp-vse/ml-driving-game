// Report numbers, computed in the admin's browser (app_spec 6.4, data contract 6).
// Pure functions: no DOM, no network, so they are unit-tested.

import type { ExportResult } from './exports';

export const CLIP = 0.001; // p is clipped to [CLIP, 1 - CLIP] for scoring (contract section 5)
export const BOOTSTRAP_ROUNDS = 1000;

export interface ReportData extends ExportResult {
  study_full: {
    title: string;
    code: string;
    status: 'draft' | 'open' | 'closed';
    created_at: string;
    closed_at: string | null;
    params: { test_rounds: number; min_rounds: number };
  };
  players: { nick: string; device: string; country: string | null }[];
  uploads: { team: string; uploaded_at: string; accepted: boolean; release: number | null; messages: { level: string; code: string; n?: number }[] }[];
  last_accepted: { team: string; uploaded_at: string; rows: { round_id: string; p: number }[] }[];
}

type FileRow = { round_id: string; player: string; accident: number };

export function clip(p: number): number {
  return Math.min(1 - CLIP, Math.max(CLIP, p));
}

export function logLoss(pairs: { y: number; p: number }[]): number {
  if (pairs.length === 0) return NaN;
  let s = 0;
  for (const { y, p } of pairs) {
    const q = clip(p);
    s += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
  }
  return s / pairs.length;
}

/** Small seeded generator, so a report can be reproduced exactly. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Entry {
  name: string;
  kind: 'team' | 'reference';
  uploaded_at?: string;
  logLoss: number | null; // null: cannot be scored (see note)
  low: number | null;
  high: number | null;
  note?: string;
}

/**
 * The leaderboard: each team's last accepted file and the two reference rows, scored by log loss
 * on game_test.csv, with a bootstrap interval that resamples players (their rounds are not
 * independent). The same resamples are used for every entry, so intervals are comparable.
 */
export function leaderboard(d: ReportData, seed = 20261119, rounds = BOOTSTRAP_ROUNDS): Entry[] {
  const train = d.files.filter((r) => r.file === 'train') as unknown as FileRow[];
  const test = d.files.filter((r) => r.file === 'test') as unknown as FileRow[];
  if (test.length === 0) return [];

  // Reference rows (contract section 6).
  const baseRate = train.length ? train.reduce((s, r) => s + r.accident, 0) / train.length : 0.5;
  const perPlayer = new Map<string, { acc: number; n: number }>();
  for (const r of train) {
    const x = perPlayer.get(r.player) ?? { acc: 0, n: 0 };
    x.acc += r.accident;
    x.n += 1;
    perPlayer.set(r.player, x);
  }
  const ownRate = (player: string) => {
    const x = perPlayer.get(player) ?? { acc: 0, n: 0 };
    return (x.acc + 1) / (x.n + 2);
  };

  const predictors: { entry: Entry; p: (r: FileRow) => number | undefined }[] = [
    {
      entry: { name: 'Base rate (one p for everybody)', kind: 'reference', logLoss: null, low: null, high: null },
      p: () => baseRate,
    },
    {
      entry: { name: "Player's own rate", kind: 'reference', logLoss: null, low: null, high: null },
      p: (r) => ownRate(r.player),
    },
  ];
  for (const t of d.last_accepted) {
    const m = new Map(t.rows.map((x) => [x.round_id, x.p]));
    const missing = test.filter((r) => !m.has(r.round_id)).length;
    const entry: Entry = { name: t.team, kind: 'team', uploaded_at: t.uploaded_at, logLoss: null, low: null, high: null };
    if (missing > 0) {
      entry.note = `not scored: the file misses ${missing} test rounds (uploaded before the test set was final)`;
      predictors.push({ entry, p: () => undefined });
    } else {
      predictors.push({ entry, p: (r) => m.get(r.round_id) });
    }
  }

  // Point estimates.
  const scored = predictors.filter((x) => !x.entry.note);
  for (const x of scored) x.entry.logLoss = logLoss(test.map((r) => ({ y: r.accident, p: x.p(r)! })));

  // Bootstrap over players.
  const byPlayer = new Map<string, FileRow[]>();
  for (const r of test) byPlayer.set(r.player, [...(byPlayer.get(r.player) ?? []), r]);
  const players = [...byPlayer.keys()];
  const rand = mulberry32(seed);
  const samples: number[][] = scored.map(() => []);
  for (let b = 0; b < rounds; b++) {
    const rows: FileRow[] = [];
    for (let i = 0; i < players.length; i++) rows.push(...byPlayer.get(players[Math.floor(rand() * players.length)])!);
    scored.forEach((x, k) => samples[k].push(logLoss(rows.map((r) => ({ y: r.accident, p: x.p(r)! })))));
  }
  scored.forEach((x, k) => {
    const s = samples[k].sort((a, b) => a - b);
    x.entry.low = s[Math.floor(0.025 * (s.length - 1))];
    x.entry.high = s[Math.ceil(0.975 * (s.length - 1))];
  });

  const all = predictors.map((x) => x.entry);
  return [
    ...all.filter((e) => e.logLoss !== null).sort((a, b) => a.logLoss! - b.logLoss!),
    ...all.filter((e) => e.logLoss === null),
  ];
}

export interface Share {
  label: string;
  n: number;
  accidents: number;
  share: number;
}

const counted = (o: unknown) =>
  o === 'delivered' || o === 'crash_car' || o === 'crash_obstacle' || o === 'crash_pedestrian';
const isCrash = (o: unknown) => o === 'crash_car' || o === 'crash_obstacle' || o === 'crash_pedestrian';

function shares(rows: Record<string, unknown>[], key: (r: Record<string, unknown>) => string): Share[] {
  const m = new Map<string, { n: number; a: number }>();
  for (const r of rows) {
    if (!counted(r.outcome)) continue;
    const k = key(r);
    const x = m.get(k) ?? { n: 0, a: 0 };
    x.n += 1;
    if (isCrash(r.outcome)) x.a += 1;
    m.set(k, x);
  }
  return [...m.entries()].map(([label, x]) => ({ label, n: x.n, accidents: x.a, share: x.a / x.n }));
}

export interface Summary {
  joined: number;
  inTest: number;
  roundsRecorded: number;
  roundsCounted: number;
  timeoutsDropped: number;
  unfinished: number;
  byDevicePlayers: { label: string; n: number }[];
  byCountryPlayers: { label: string; n: number }[];
  overall: Share | null;
  byAttempt: Share[]; // attempts above 25 are grouped as "26+"
  byDevice: Share[];
}

export function summarize(d: ReportData): Summary {
  const count = (vals: string[]) => {
    const m = new Map<string, number>();
    for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
  };
  const overall = shares(d.raw, () => 'all')[0] ?? null;
  const byAttempt = shares(d.raw, (r) => (Number(r.attempt) > 25 ? '26+' : String(r.attempt)))
    .sort((a, b) => (a.label === '26+' ? 1 : b.label === '26+' ? -1 : Number(a.label) - Number(b.label)));
  return {
    joined: d.players.length,
    inTest: d.counts.players_in_test,
    roundsRecorded: d.raw.length,
    roundsCounted: d.raw.filter((r) => counted(r.outcome)).length,
    timeoutsDropped: d.counts.dropped_timeout_or_breakdown,
    unfinished: d.counts.dropped_unfinished,
    byDevicePlayers: count(d.players.map((p) => p.device)),
    byCountryPlayers: count(d.players.map((p) => p.country ?? 'unknown')),
    overall,
    byAttempt,
    byDevice: shares(d.raw, (r) => String(r.device)).sort((a, b) => a.label.localeCompare(b.label)),
  };
}
