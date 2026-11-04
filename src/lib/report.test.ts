import { describe, it, expect } from 'vitest';
import { clip, leaderboard, logLoss, summarize, type ReportData } from './report';

const row = (file: 'train' | 'test', player: string, round_id: string, accident: number, attempt = 1) =>
  ({ file, player, round_id, accident, attempt }) as any;

function data(): ReportData {
  return {
    study: { code: 'ABC234', title: 't', test_rounds: 2 },
    study_full: { title: 't', code: 'ABC234', status: 'open', created_at: '', closed_at: null, params: { test_rounds: 2, training_seconds: 600 } },
    files: [
      // anna crashes a lot in training, bob rarely.
      row('train', 'anna', 'a1', 1), row('train', 'anna', 'a2', 1), row('train', 'anna', 'a3', 0),
      row('train', 'bob', 'b1', 0), row('train', 'bob', 'b2', 0), row('train', 'bob', 'b3', 0),
      row('test', 'anna', 'a4', 1), row('test', 'anna', 'a5', 1),
      row('test', 'bob', 'b4', 0), row('test', 'bob', 'b5', 0),
    ],
    raw: [],
    counts: { players_complete: 2, dropped_timeout_or_breakdown: 1, dropped_interrupted: 0 } as any,
    players: [{ nick: 'anna', device: 'touch', country: 'CZ' }, { nick: 'bob', device: 'mouse', country: 'CZ' }, { nick: 'cleo', device: 'touch', country: null }],
    uploads: [],
    last_accepted: [
      { team: 'Perfect-ish', uploaded_at: 'x', rows: [{ round_id: 'a4', p: 0.9 }, { round_id: 'a5', p: 0.9 }, { round_id: 'b4', p: 0.1 }, { round_id: 'b5', p: 0.1 }] },
      { team: 'Late file', uploaded_at: 'y', rows: [{ round_id: 'a4', p: 0.5 }] },
    ],
  };
}

describe('log loss', () => {
  it('is the mean of -(y log p + (1 - y) log(1 - p)), with p clipped', () => {
    expect(logLoss([{ y: 1, p: 0.5 }, { y: 0, p: 0.5 }])).toBeCloseTo(Math.log(2), 12);
    expect(logLoss([{ y: 1, p: 0.9 }])).toBeCloseTo(-Math.log(0.9), 12);
    expect(clip(0)).toBe(0.001);
    expect(clip(1)).toBe(0.999);
    expect(logLoss([{ y: 1, p: 0 }])).toBeCloseTo(-Math.log(0.001), 12);
  });
});

describe('leaderboard', () => {
  it('scores teams and both reference rows; sorted best first; late files not scored', () => {
    const lb = leaderboard(data(), 1, 200);
    const by = Object.fromEntries(lb.map((e) => [e.name, e]));
    expect(by['Perfect-ish'].logLoss).toBeCloseTo(-Math.log(0.9), 12);
    // Base rate: 2 accidents in 6 training rounds.
    const base = 2 / 6;
    expect(by['Base rate (one p for everybody)'].logLoss).toBeCloseTo(-(2 * Math.log(base) + 2 * Math.log(1 - base)) / 4, 12);
    // Own rate: anna (2+1)/(3+2) = 0.6, bob (0+1)/(3+2) = 0.2.
    expect(by["Player's own rate"].logLoss).toBeCloseTo(-(2 * Math.log(0.6) + 2 * Math.log(0.8)) / 4, 12);
    expect(lb.map((e) => e.name)).toEqual(['Perfect-ish', "Player's own rate", 'Base rate (one p for everybody)', 'Late file']);
    expect(by['Late file']).toMatchObject({ logLoss: null, note: expect.stringMatching(/misses 3 test rounds/) });
  });

  it('bootstrap intervals contain the estimate and are reproducible with the same seed', () => {
    const a = leaderboard(data(), 7, 300);
    const b = leaderboard(data(), 7, 300);
    expect(a).toEqual(b);
    for (const e of a.filter((x) => x.logLoss !== null)) {
      expect(e.low!).toBeLessThanOrEqual(e.logLoss! + 1e-12);
      expect(e.high!).toBeGreaterThanOrEqual(e.logLoss! - 1e-12);
    }
  });

  it('is empty without test rounds', () => {
    const d = data();
    d.files = d.files.filter((r) => r.file === 'train');
    expect(leaderboard(d)).toEqual([]);
  });
});

describe('summary', () => {
  it('counts players by device and country, and accident shares from counted rounds only', () => {
    const d = data();
    d.raw = [
      { attempt: 1, device: 'touch', outcome: 'crash_car' },
      { attempt: 1, device: 'mouse', outcome: 'delivered' },
      { attempt: 2, device: 'touch', outcome: 'timeout' },
      { attempt: 2, device: 'touch', outcome: 'delivered' },
      { attempt: 30, device: 'mouse', outcome: 'crash_obstacle' },
      { attempt: 3, device: 'mouse', outcome: null },
    ];
    const s = summarize(d);
    expect(s.joined).toBe(3);
    expect(s.byDevicePlayers).toEqual([{ label: 'touch', n: 2 }, { label: 'mouse', n: 1 }]);
    expect(s.byCountryPlayers).toEqual([{ label: 'CZ', n: 2 }, { label: 'unknown', n: 1 }]);
    expect(s.roundsRecorded).toBe(6);
    expect(s.roundsCounted).toBe(4);
    expect(s.overall).toMatchObject({ n: 4, accidents: 2, share: 0.5 });
    expect(s.byAttempt.map((x) => [x.label, x.n, x.share])).toEqual([['1', 2, 0.5], ['2', 1, 0], ['26+', 1, 1]]);
    expect(s.byDevice.map((x) => [x.label, x.n])).toEqual([['mouse', 2], ['touch', 2]]);
  });
});

import { renderReport } from './reportHtml';

describe('report HTML', () => {
  it('is one self-contained page: escaped names, no scripts, no external files, no dashes', () => {
    const d = data();
    d.last_accepted[0].team = '<script>alert(1)</script>';
    d.uploads = [{ team: '<b>x</b>', uploaded_at: '2026-11-19T10:00:00Z', accepted: false, messages: [{ level: 'error', code: 'missing_ids', n: 2 }] }];
    const html = renderReport(d, 'final', new Date('2026-11-19T12:00:00Z'));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).toContain('Final report');
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/[–—−]/);
  });
});
