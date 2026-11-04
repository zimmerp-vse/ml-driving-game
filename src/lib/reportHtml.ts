// The report as one self-contained HTML file: inline CSS, charts as inline SVG, no scripts,
// no external files. It is shown on the projector, so the text follows the student-text rules
// (plain English, no dashes). Every value from users (team names, nicks) is escaped.

import { leaderboard, summarize, CLIP, BOOTSTRAP_ROUNDS, type Entry, type ReportData, type Share } from './report';
import { describe } from './submission';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const f3 = (x: number | null) => (x === null || !Number.isFinite(x) ? '' : x.toFixed(3));
const pct = (x: number) => `${Math.round(x * 100)} %`;
const time = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

const C = { team: '#1d4ed8', ref: '#6b7280', grid: '#e5e7eb', axis: '#374151', bar: '#f97316', line: '#ec4899' };

function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0)!;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

/** Dot plot: log loss of each entry with its bootstrap interval; lower is better. */
function dotPlot(entries: Entry[]): string {
  const rows = entries.filter((e) => e.logLoss !== null);
  if (rows.length === 0) return '';
  const W = 960, L = 300, R = 30, rowH = 40, top = 20, H = top + rows.length * rowH + 50;
  const lo = Math.min(...rows.map((e) => e.low ?? e.logLoss!));
  const hi = Math.max(...rows.map((e) => e.high ?? e.logLoss!));
  const pad = (hi - lo) * 0.08 || 0.05;
  const x0 = Math.max(0, lo - pad), x1 = hi + pad;
  const x = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const ticks = niceTicks(x0, x1);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Leaderboard: log loss with intervals">`;
  for (const t of ticks) {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 8}" y2="${H - 40}" stroke="${C.grid}"/>`;
    s += `<text x="${x(t)}" y="${H - 22}" text-anchor="middle" font-size="16" fill="${C.axis}">${t.toFixed(2)}</text>`;
  }
  s += `<text x="${(L + W - R) / 2}" y="${H - 2}" text-anchor="middle" font-size="16" fill="${C.axis}">log loss (lower is better)</text>`;
  rows.forEach((e, i) => {
    const y = top + i * rowH + rowH / 2;
    const ref = e.kind === 'reference';
    const col = ref ? C.ref : C.team;
    s += `<text x="${L - 14}" y="${y + 6}" text-anchor="end" font-size="18" fill="${col}"${ref ? ' font-style="italic"' : ' font-weight="600"'}>${esc(e.name)}</text>`;
    if (e.low !== null && e.high !== null) {
      s += `<line x1="${x(e.low)}" x2="${x(e.high)}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="3" stroke-linecap="round" opacity="0.6"/>`;
    }
    s += ref
      ? `<rect x="${x(e.logLoss!) - 8}" y="${y - 8}" width="16" height="16" fill="white" stroke="${col}" stroke-width="3" transform="rotate(45 ${x(e.logLoss!)} ${y})"/>`
      : `<circle cx="${x(e.logLoss!)}" cy="${y}" r="9" fill="${col}"/>`;
  });
  return s + '</svg>';
}

/** Accident share by attempt: the learning curve. Dot area follows the number of rounds. */
function learningCurve(rows: Share[]): string {
  if (rows.length === 0) return '';
  const W = 960, H = 340, L = 60, R = 20, T = 20, B = 60;
  const step = (W - L - R) / rows.length;
  const x = (i: number) => L + step * (i + 0.5);
  const y = (v: number) => T + (1 - v) * (H - T - B);
  const maxN = Math.max(...rows.map((r) => r.n));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Accident share by attempt">`;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${C.grid}"/>`;
    s += `<text x="${L - 8}" y="${y(t) + 5}" text-anchor="end" font-size="15" fill="${C.axis}">${pct(t)}</text>`;
  }
  s += `<polyline fill="none" stroke="${C.line}" stroke-width="2.5" points="${rows.map((r, i) => `${x(i)},${y(r.share)}`).join(' ')}"/>`;
  const every = Math.ceil(rows.length / 20);
  rows.forEach((r, i) => {
    const rad = 3 + 9 * Math.sqrt(r.n / maxN);
    s += `<circle cx="${x(i)}" cy="${y(r.share)}" r="${rad}" fill="${C.line}" opacity="0.85"><title>attempt ${esc(r.label)}: ${r.accidents} of ${r.n}</title></circle>`;
    if (i % every === 0) s += `<text x="${x(i)}" y="${H - B + 22}" text-anchor="middle" font-size="15" fill="${C.axis}">${esc(r.label)}</text>`;
  });
  s += `<text x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle" font-size="16" fill="${C.axis}">attempt (dot size: number of counted rounds)</text>`;
  return s + '</svg>';
}

function shareBars(rows: Share[]): string {
  if (rows.length === 0) return '';
  const W = 960, L = 140, R = 160, rowH = 44, H = rows.length * rowH + 10;
  const x = (v: number) => L + v * (W - L - R);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Accident share by device">`;
  rows.forEach((r, i) => {
    const y = 5 + i * rowH;
    s += `<text x="${L - 12}" y="${y + 27}" text-anchor="end" font-size="18" fill="${C.axis}">${esc(r.label)}</text>`;
    s += `<rect x="${L}" y="${y + 6}" width="${x(1) - L}" height="28" fill="${C.grid}" rx="4"/>`;
    s += `<rect x="${L}" y="${y + 6}" width="${x(r.share) - L}" height="28" fill="${C.bar}" rx="4"/>`;
    s += `<text x="${x(1) + 12}" y="${y + 27}" font-size="18" fill="${C.axis}">${pct(r.share)} of ${r.n}</text>`;
  });
  return s + '</svg>';
}

const card = (label: string, value: number | string) =>
  `<div class="card"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`;

export function renderReport(d: ReportData, kind: 'running' | 'final', at = new Date()): string {
  const s = summarize(d);
  const lb = leaderboard(d);
  const title = `${kind === 'final' ? 'Final report' : 'Running report'}: ${d.study_full.title}`;
  const uploads = d.uploads;

  // Ranks for teams only; reference rows are shown between them without a number.
  let rank = 0;
  const ranks = lb.map((e) => (e.kind === 'team' && e.logLoss !== null ? String(++rank) : ''));
  const lbTable = lb.length
    ? `<table><thead><tr><th>#</th><th>Team</th><th class="num">Log loss</th><th class="num">95 % interval</th><th>Uploaded</th></tr></thead><tbody>${lb
        .map((e, i) => `<tr class="${e.kind}"><td>${ranks[i]}</td><td>${esc(e.name)}${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</td>
          <td class="num">${f3(e.logLoss)}</td><td class="num">${e.low === null ? '' : `${f3(e.low)} to ${f3(e.high)}`}</td>
          <td>${e.uploaded_at ? esc(time(e.uploaded_at)) : e.kind === 'reference' ? 'reference' : ''}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p>No test rounds yet.</p>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111827; background: #fff; margin: 0; }
  main { max-width: 1040px; margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-size: 34px; margin: 0 0 4px; } h2 { font-size: 26px; margin: 44px 0 12px; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; }
  .meta { color: #6b7280; font-size: 16px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px 16px; }
  .card .label { color: #6b7280; font-size: 14px; text-transform: uppercase; letter-spacing: .04em; }
  .card .value { font-size: 34px; font-weight: 600; font-variant-numeric: tabular-nums; }
  table { border-collapse: collapse; width: 100%; font-size: 17px; margin-top: 8px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  th { color: #6b7280; font-weight: 500; } .num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.reference td { color: #6b7280; font-style: italic; } .note { font-size: 14px; color: #b45309; font-style: normal; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; } p.small { color: #6b7280; font-size: 15px; }
  .ok { color: #15803d; } .no { color: #b91c1c; }
  @media (max-width: 700px) { .two { grid-template-columns: 1fr; } }
</style></head>
<body><main>
<h1>${esc(title)}</h1>
<div class="meta">Study ${esc(d.study_full.code)}. Made ${esc(at.toLocaleString('en-GB'))}.</div>

<h2>Leaderboard</h2>
${dotPlot(lb)}
${lbTable}
<p class="small">Each team's last accepted file, scored on the rounds of game_test.csv. For scoring, p is kept between ${CLIP} and ${1 - CLIP}.
The interval comes from ${BOOTSTRAP_ROUNDS} bootstrap samples that draw whole players (a player's rounds are not independent).
Reference rows: one p for everybody (the accident share in game_train.csv), and each player's own share in game_train.csv as (accidents + 1) / (rounds + 2).</p>

<h2>Who played</h2>
<div class="cards">
${card('Joined', s.joined)}${card('Complete', s.complete)}${card('Rounds', s.roundsRecorded)}${card('Counted', s.roundsCounted)}${card('Timeouts', s.timeoutsDropped)}${card('Interrupted', s.interrupted)}
</div>
<div class="two">
<table><thead><tr><th>Device</th><th class="num">Players</th></tr></thead><tbody>${s.byDevicePlayers.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${r.n}</td></tr>`).join('')}</tbody></table>
<table><thead><tr><th>Country</th><th class="num">Players</th></tr></thead><tbody>${s.byCountryPlayers.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${r.n}</td></tr>`).join('')}</tbody></table>
</div>

<h2>Accidents</h2>
<p>${s.overall ? `Accident share over all counted rounds: <b>${pct(s.overall.share)}</b> (${s.overall.accidents} of ${s.overall.n}).` : 'No counted rounds yet.'}</p>
<h3>By attempt: the learning curve</h3>
${learningCurve(s.byAttempt)}
<h3>By device</h3>
${shareBars(s.byDevice)}

<h2>Uploads</h2>
${uploads.length ? `<table><thead><tr><th>Team</th><th>Time</th><th>Result</th><th>Notes</th></tr></thead><tbody>${uploads
    .map((u) => `<tr><td>${esc(u.team)}</td><td>${esc(time(u.uploaded_at))}</td><td class="${u.accepted ? 'ok' : 'no'}">${u.accepted ? 'accepted' : 'rejected'}</td>
      <td>${u.messages.filter((m) => m.level !== 'info').map((m) => esc(describe(m as never))).join('<br>')}</td></tr>`)
    .join('')}</tbody></table>` : '<p>No uploads yet.</p>'}
</main></body></html>`;
}
