// /admin/study/:id: one study. Live progress (every 5 s); releases of the data with a preview
// (data contract v07: the split is made at release); the files of each release; the students'
// switches; reports (app_spec sections 6.2 to 6.4).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AdminGate, Shell, SignOut } from './AdminPage';
import { buildFiles, download, type ExportCounts, type ExportResult, type Release } from '../lib/exports';
import { closeStudy, downloadReport, makeReport, reportFileName, showReport } from '../lib/reportFlow';

interface Study {
  id: string;
  code: string;
  title: string;
  status: 'draft' | 'open' | 'closed';
  params: {
    test_rounds?: number;
    min_rounds?: number;
    ranges: Record<string, { min: number; max: number; scale: string }>;
    fixed: Record<string, unknown>;
  };
  data_released: boolean;
  submissions_open: boolean;
  created_at: string;
}

interface PlayerRow {
  nick: string;
  device: string;
  country: string | null;
  rounds_played: number;
  counted: number;
  accidents: number;
  seconds: number;
  done: boolean;
  playing: boolean;
  last_activity_at: string;
}

interface Progress {
  min_rounds: number;
  players: PlayerRow[];
  totals: { joined: number; playing: number; enough_rounds: number; done: number };
}

const POLL_MS = 5000;
const STATUS_LABEL = { draft: 'Not open yet', open: 'Open', closed: 'Closed' } as const;

export default function StudyPage() {
  return (
    <AdminGate>
      {(email) => <StudyView email={email} />}
    </AdminGate>
  );
}

function StudyView({ email }: { email: string }) {
  const id = useParams().id ?? '';
  const [study, setStudy] = useState<Study | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [releasesVersion, setReleasesVersion] = useState(0);

  const loadStudy = useCallback(async () => {
    const { data, error } = await supabase.rpc('mlg_admin_get_study', { p_id: id });
    if (error) setError(error.message);
    else if (!data) setError('Study not found.');
    else setStudy(data as Study);
  }, [id]);

  useEffect(() => {
    loadStudy();
  }, [loadStudy]);

  const [reportsVersion, setReportsVersion] = useState(0);

  async function close() {
    if (!window.confirm('Close the study? Nobody can join or play any more, submissions close, and the final report is made for the latest release.')) return;
    try {
      await closeStudy(id);
      setReportsVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
    loadStudy();
  }

  async function setStatus(status: Study['status']) {
    const { error } = await supabase.rpc('mlg_admin_set_status', { p_id: id, p_status: status });
    if (error) setError(error.message);
    loadStudy();
  }

  async function setFlag(flag: 'data_released' | 'submissions_open', value: boolean) {
    const { error } = await supabase.rpc('mlg_admin_set_flags', {
      p_id: id,
      p_data_released: flag === 'data_released' ? value : null,
      p_submissions_open: flag === 'submissions_open' ? value : null,
    });
    if (error) setError(error.message);
    loadStudy();
  }

  if (!study) return <Shell>{error ?? 'Loading...'}</Shell>;
  const p = study.params;
  const testRounds = p.test_rounds ?? 5;
  const minRounds = p.min_rounds ?? 10;

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <div className="flex items-baseline justify-between text-sm">
        <Link to="/admin" className="text-blue-700 underline">All studies</Link>
        <span className="text-slate-500">{email} <SignOut /></span>
      </div>
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{study.title}</h1>
          <p className="text-sm text-slate-600">
            Code <span className="font-mono font-semibold">{study.code}</span> · {STATUS_LABEL[study.status]} ·
            created {new Date(study.created_at).toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Players play as long as they like. Release defaults: the test is each player's last {testRounds} counted
            rounds, for players with at least {minRounds}. Time limit {p.ranges.trip_seconds?.min} to {p.ranges.trip_seconds?.max} s
            {p.fixed.deliveryDistance ? `, road ${p.fixed.deliveryDistance}` : ''}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a href={`/s/${study.code}`} target="_blank" rel="noreferrer" className="text-blue-700 underline">Join page</a>
          <a href={`/screen/${study.code}`} target="_blank" rel="noreferrer" className="text-blue-700 underline">QR screen</a>
          {study.status !== 'open' ? (
            <button onClick={() => setStatus('open')} className="rounded bg-green-700 px-3 py-1.5 text-white">Open</button>
          ) : (
            <button onClick={close} className="rounded bg-slate-700 px-3 py-1.5 text-white">Close</button>
          )}
        </div>
      </header>

      <LiveProgress id={id} />

      <Releases
        id={id}
        defaults={{ testRounds, minRounds }}
        version={releasesVersion}
        onReleased={() => {
          setReleasesVersion((v) => v + 1);
          loadStudy();
        }}
      />

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Students</h2>
        <Switch
          checked={study.data_released}
          onChange={(v) => setFlag('data_released', v)}
          label="Students can download the latest release"
          help="game_train.csv and game_test.csv of the latest release on the submission page. Making a release turns this on; turn it off to hide the files again."
        />
        <Switch
          checked={study.submissions_open}
          onChange={(v) => setFlag('submissions_open', v)}
          label="Submissions open"
          help="Teams can upload predictions for the latest release. Closing the study also closes submissions."
        />
        <p className="text-sm">
          Submission page for teams:{' '}
          <a href={`/s/${study.code}/submit`} target="_blank" rel="noreferrer" className="font-mono text-blue-700 underline">
            {window.location.host}/s/{study.code}/submit
          </a>
        </p>
      </section>

      <Reports id={id} code={study.code} version={reportsVersion} />
    </main>
  );
}

function Switch({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; help: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5" />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-sm text-slate-500">{help}</span>
      </span>
    </label>
  );
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return new Date(iso).toLocaleTimeString();
}

const minutes = (sec: number) => (sec < 60 ? `${sec} s` : `${Math.round(sec / 60)} min`);

function LiveProgress({ id }: { id: string }) {
  const [data, setData] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.rpc('mlg_admin_progress', { p_id: id });
      if (!alive) return;
      if (error) setError(error.message);
      else {
        setError(null);
        setData(data as Progress);
        setUpdated(Date.now());
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Live progress</h2>
        <span className="text-xs text-slate-500">
          {error ? `Update failed: ${error}` : `Updated ${new Date(updated).toLocaleTimeString()}, every 5 s`}
        </span>
      </div>
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Total label="Joined" value={data.totals.joined} />
            <Total label="Playing" value={data.totals.playing} />
            <Total label={`${data.min_rounds}+ counted rounds`} value={data.totals.enough_rounds} />
            <Total label="Done" value={data.totals.done} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2">Player</th><th>Device</th><th>Country</th><th>Rounds</th><th>Counted</th>
                  <th>Accidents</th><th>Time</th><th>Status</th><th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {data.players.map((r) => (
                  <tr key={r.nick} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-medium">
                      {r.playing && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-500" title="playing" />}
                      {r.nick}
                    </td>
                    <td>{r.device}</td>
                    <td>{r.country ?? ''}</td>
                    <td className="tabular-nums">{r.rounds_played}</td>
                    <td className={`tabular-nums ${r.counted >= data.min_rounds ? 'font-semibold text-green-800' : ''}`}>{r.counted}</td>
                    <td className="tabular-nums">{r.accidents}</td>
                    <td className="tabular-nums">{minutes(r.seconds)}</td>
                    <td>
                      <span className={`rounded px-2 py-0.5 text-xs ${r.done ? 'bg-green-100 text-green-800' : r.playing ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600'}`}>
                        {r.done ? 'done' : r.playing ? 'playing' : r.rounds_played ? 'away' : 'not started'}
                      </span>
                    </td>
                    <td className="text-slate-600">{ago(r.last_activity_at, updated)}</td>
                  </tr>
                ))}
                {data.players.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-4 text-slate-500">Nobody has joined yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

type FileRow = { file: 'train' | 'test'; player: string; attempt: number; accident: number };

interface Preview {
  settings: { cutoff: string; test_rounds: number; min_rounds: number };
  files: FileRow[];
  counts: ExportCounts;
}

/** What the teacher decides a release on: shares, rounds per player, the learning curve. */
export function previewSummary(files: FileRow[]) {
  const share = (rows: FileRow[]) => (rows.length ? rows.reduce((s, r) => s + r.accident, 0) / rows.length : null);
  const train = files.filter((r) => r.file === 'train');
  const test = files.filter((r) => r.file === 'test');
  const perPlayer = new Map<string, number>();
  for (const r of files) perPlayer.set(r.player, (perPlayer.get(r.player) ?? 0) + 1);
  const n = [...perPlayer.values()].sort((a, b) => a - b);
  const byAttempt = new Map<number, { n: number; a: number }>();
  for (const r of files) {
    const k = Math.min(r.attempt, 30);
    const x = byAttempt.get(k) ?? { n: 0, a: 0 };
    x.n += 1;
    x.a += r.accident;
    byAttempt.set(k, x);
  }
  return {
    shareTrain: share(train),
    shareTest: share(test),
    roundsPerPlayer: n.length ? { min: n[0], median: n[Math.floor((n.length - 1) / 2)], max: n[n.length - 1] } : null,
    curve: [...byAttempt.entries()].sort((a, b) => a[0] - b[0]).map(([attempt, x]) => ({ attempt, n: x.n, share: x.a / x.n })),
  };
}

const pct = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)} %`);

function Curve({ points }: { points: { attempt: number; n: number; share: number }[] }) {
  if (points.length === 0) return null;
  const W = 420, H = 140, L = 34, B = 22;
  const maxA = Math.max(...points.map((p) => p.attempt), 10);
  const maxN = Math.max(...points.map((p) => p.n));
  const x = (a: number) => L + ((a - 1) / Math.max(1, maxA - 1)) * (W - L - 10);
  const y = (s: number) => 8 + (1 - s) * (H - B - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" role="img" aria-label="Accident share by attempt">
      {[0, 0.5, 1].map((s) => (
        <g key={s}>
          <line x1={L} x2={W - 10} y1={y(s)} y2={y(s)} stroke="#e2e8f0" />
          <text x={L - 4} y={y(s) + 4} fontSize="10" textAnchor="end" fill="#64748b">{s * 100}%</text>
        </g>
      ))}
      <polyline fill="none" stroke="#94a3b8" points={points.map((p) => `${x(p.attempt)},${y(p.share)}`).join(' ')} />
      {points.map((p) => (
        <circle key={p.attempt} cx={x(p.attempt)} cy={y(p.share)} r={2 + 4 * Math.sqrt(p.n / maxN)} fill="#1d4ed8" opacity={0.8}>
          <title>{`attempt ${p.attempt === 30 ? '30+' : p.attempt}: ${pct(p.share)} of ${p.n}`}</title>
        </circle>
      ))}
      <text x={L} y={H - 4} fontSize="10" fill="#64748b">attempt 1</text>
      <text x={W - 10} y={H - 4} fontSize="10" textAnchor="end" fill="#64748b">{maxA >= 30 ? '30+' : maxA}</text>
    </svg>
  );
}

function localInput(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function Releases({ id, defaults, version, onReleased }: {
  id: string;
  defaults: { testRounds: number; minRounds: number };
  version: number;
  onReleased: () => void;
}) {
  const [list, setList] = useState<Release[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('mlg_admin_list_releases', { p_id: id });
    if (error) setError(error.message);
    else setList(data as Release[]);
  }, [id]);

  useEffect(() => {
    load();
  }, [load, version]);

  async function downloadFiles(release: number | null, which: 'all' | 'raw') {
    setBusy(`${release}-${which}`);
    setError(null);
    const { data, error } = await supabase.rpc('mlg_admin_export', { p_id: id, p_release: release });
    setBusy(null);
    if (error) return setError(error.message);
    const files = buildFiles(data as ExportResult);
    for (const f of files) {
      if (which === 'raw' ? f.name.startsWith('game_raw_') : !f.name.startsWith('game_raw_')) download(f);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Data releases</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => downloadFiles(null, 'raw')} disabled={!!busy}
            className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
            Raw file (all rounds) ↓
          </button>
          {!open && (
            <button onClick={() => setOpen(true)} className="rounded bg-blue-700 px-4 py-2 font-semibold text-white">
              {list.length ? 'Prepare a new release' : 'Prepare a release'}
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-500">
        A release splits the rounds played so far into game_train.csv and game_test.csv and gives them to the students.
        You see a preview first. You can release again at any time (for example after more play, or with other settings);
        students and teams always get the latest release, and teams then upload again. The raw file never changes.
      </p>
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
      {open && (
        <ReleaseDialog
          id={id}
          defaults={defaults}
          latest={list[0]?.number ?? 0}
          onCancel={() => setOpen(false)}
          onReleased={() => {
            setOpen(false);
            load();
            onReleased();
          }}
        />
      )}
      {list.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="border-b text-slate-500">
            <tr><th className="py-2">Release</th><th>Made</th><th>Rounds up to</th><th>Test</th><th>Rows</th><th /></tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={r.number} className="border-b last:border-0">
                <td className="py-2 font-medium">
                  {r.number}
                  {i === 0 && <span className="ml-2 rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">latest</span>}
                </td>
                <td className="text-slate-600">{new Date(r.created_at).toLocaleString()}</td>
                <td className="text-slate-600">{new Date(r.cutoff).toLocaleTimeString()}</td>
                <td className="text-slate-600">last {r.test_rounds} of {r.min_rounds}+ · {r.counts.players_in_test} players</td>
                <td className="tabular-nums text-slate-600">{r.counts.train_rows} train, {r.counts.test_rows} test</td>
                <td className="text-right">
                  <button onClick={() => downloadFiles(r.number, 'all')} disabled={!!busy}
                    className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-50">
                    {busy === `${r.number}-all` ? 'Preparing...' : 'Files ↓'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.length > 0 && (
        <p className="text-xs text-slate-500">
          Files ↓ downloads game_train.csv, game_test.csv and game_labels.csv (teacher only, never to students) of that release.
        </p>
      )}
    </section>
  );
}

function ReleaseDialog({ id, defaults, latest, onCancel, onReleased }: {
  id: string;
  defaults: { testRounds: number; minRounds: number };
  latest: number;
  onCancel: () => void;
  onReleased: () => void;
}) {
  const [testRounds, setTestRounds] = useState(String(defaults.testRounds));
  const [minRounds, setMinRounds] = useState(String(defaults.minRounds));
  const [cutoffMode, setCutoffMode] = useState<'now' | 'at'>('now');
  const [cutoffAt, setCutoffAt] = useState(localInput(new Date().toISOString()));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const t = Number(testRounds);
  const m = Number(minRounds);
  const valid = Number.isInteger(t) && Number.isInteger(m) && t >= 1 && t <= 50 && m > t && m <= 1000;
  const cutoff = cutoffMode === 'now' ? null : new Date(cutoffAt).toISOString();

  const refresh = useCallback(async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc('mlg_admin_release_preview', {
      p_id: id, p_cutoff: cutoff, p_test_rounds: t, p_min_rounds: m,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setPreview(data as Preview);
  }, [id, cutoff, t, m, valid]);

  useEffect(() => {
    refresh();
    // Only on open; later changes are previewed with the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function release() {
    if (!preview) return;
    if (latest > 0 && !window.confirm(
      `Release ${latest + 1} replaces release ${latest} for the students. Teams have to download the files again and upload new predictions. Continue?`)) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('mlg_admin_create_release', {
      p_id: id, p_cutoff: preview.settings.cutoff, p_test_rounds: preview.settings.test_rounds, p_min_rounds: preview.settings.min_rounds,
    });
    setBusy(false);
    if (error) return setError(error.message);
    onReleased();
  }

  const s = useMemo(() => (preview ? previewSummary(preview.files) : null), [preview]);
  const c = preview?.counts;
  const stale = preview && (preview.settings.test_rounds !== t || preview.settings.min_rounds !== m ||
    (cutoffMode === 'at' && cutoff !== null && new Date(preview.settings.cutoff).getTime() !== new Date(cutoff).getTime()));

  return (
    <div className="space-y-4 rounded-lg border-2 border-blue-200 bg-blue-50/40 p-4">
      <h3 className="font-semibold">{latest ? `Release ${latest + 1}` : 'Release 1'}: settings and preview</h3>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label>
          Test rounds per player
          <input value={testRounds} onChange={(e) => setTestRounds(e.target.value)} inputMode="numeric"
            className="ml-2 w-16 rounded border border-slate-300 px-2 py-1" />
        </label>
        <label>
          Minimum counted rounds for the test
          <input value={minRounds} onChange={(e) => setMinRounds(e.target.value)} inputMode="numeric"
            className="ml-2 w-16 rounded border border-slate-300 px-2 py-1" />
        </label>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1">
            <input type="radio" checked={cutoffMode === 'now'} onChange={() => setCutoffMode('now')} /> Rounds up to now
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={cutoffMode === 'at'} onChange={() => setCutoffMode('at')} /> up to
          </label>
          <input type="datetime-local" value={cutoffAt} disabled={cutoffMode === 'now'} onChange={(e) => setCutoffAt(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50" />
        </div>
        <button onClick={refresh} disabled={!valid || busy} className="rounded border border-blue-700 px-3 py-1.5 text-blue-800 disabled:opacity-50">
          Update preview
        </button>
      </div>
      {!valid && <p className="text-sm text-red-700">Test rounds 1 to 50; the minimum must be more than the test rounds.</p>}
      <p className="text-xs text-slate-600">
        For each player, the last {valid ? t : 'N'} counted rounds (delivered or crashed) go to game_test.csv, if the player has at
        least {valid ? m : 'M'} counted rounds; all their other counted rounds go to game_train.csv. Players with fewer rounds are
        only in game_train.csv. Timeouts and unfinished rounds are in no student file.
      </p>
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
      {preview && c && s && (
        <div className={`grid gap-4 md:grid-cols-2 ${stale ? 'opacity-50' : ''}`}>
          <ul className="space-y-1 text-sm">
            <li><b>{c.players_in_test}</b> players in game_test.csv ({c.test_rows} rows), <b>{c.players_only_train}</b> only in game_train.csv, {c.players_left_out} in neither (no counted round).</li>
            <li><b>{c.train_rows}</b> rows in game_train.csv.</li>
            <li>Accident share: train <b>{pct(s.shareTrain)}</b>, test <b>{pct(s.shareTest)}</b>.</li>
            {s.roundsPerPlayer && <li>Counted rounds per player: {s.roundsPerPlayer.min} to {s.roundsPerPlayer.max}, median {s.roundsPerPlayer.median}.</li>}
            <li className="text-slate-600">Not in the student files: {c.dropped_timeout_or_breakdown} timeouts, {c.dropped_unfinished} unfinished, {c.dropped_after_cutoff} after the cutoff.</li>
            <li className="text-slate-600">Rounds up to {new Date(preview.settings.cutoff).toLocaleString()}.</li>
          </ul>
          <div>
            <div className="text-sm font-medium">Learning curve (accident share by attempt, both files)</div>
            <Curve points={s.curve} />
          </div>
        </div>
      )}
      {stale && <p className="text-sm text-amber-800">The settings changed: update the preview before you release.</p>}
      <div className="flex gap-2">
        <button onClick={release} disabled={!preview || !!stale || busy || !c?.test_rows}
          className="rounded bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
          Release to students
        </button>
        <button onClick={onCancel} className="rounded border border-slate-300 px-4 py-2">Cancel</button>
      </div>
      {preview && c && c.test_rows === 0 && <p className="text-sm text-slate-600">Nobody has enough counted rounds for the test yet.</p>}
    </div>
  );
}

interface SavedReport {
  id: number;
  kind: 'running' | 'final';
  created_at: string;
  size: number;
}

function Reports({ id, code, version }: { id: string; code: string; version: number }) {
  const [list, setList] = useState<SavedReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('mlg_admin_list_reports', { p_id: id });
    if (error) setError(error.message);
    else setList(data as SavedReport[]);
  }, [id]);

  useEffect(() => {
    load();
  }, [load, version]);

  async function makeRunning() {
    setBusy(true);
    setError(null);
    try {
      await makeReport(id, 'running');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function fetchHtml(r: SavedReport): Promise<string | null> {
    const { data, error } = await supabase.rpc('mlg_admin_get_report', { p_report_id: r.id });
    if (error) {
      setError(error.message);
      return null;
    }
    return data as string;
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Reports</h2>
        <button onClick={makeRunning} disabled={busy} className="rounded bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {busy ? 'Making...' : 'Make running report'}
        </button>
      </div>
      <p className="text-sm text-slate-500">
        Participation, accidents and the leaderboard of the last accepted files so far. Closing the study makes the final report.
        Show opens it in a new tab for the projector (full screen: F11, or Ctrl+Cmd+F on a Mac); Download saves one HTML file you can keep after the study is deleted.
      </p>
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
      {list.length === 0 ? (
        <p className="text-sm text-slate-500">No reports yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-2 font-medium">{r.kind === 'final' ? 'Final report' : 'Running report'}</td>
                <td className="text-slate-600">{new Date(r.created_at).toLocaleString()}</td>
                <td className="text-slate-500">{Math.round(r.size / 1024)} KB</td>
                <td className="space-x-2 text-right">
                  <button onClick={async () => { const h = await fetchHtml(r); if (h) showReport(h); }}
                    className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">Show</button>
                  <button onClick={async () => { const h = await fetchHtml(r); if (h) downloadReport(h, reportFileName(code, r.kind, new Date(r.created_at))); }}
                    className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">Download</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
