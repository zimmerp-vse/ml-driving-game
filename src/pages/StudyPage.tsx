// /admin/study/:id: one study. Live progress (every 5 s), the four files with the counts of the
// contract's rules, and the release / submissions switches (app_spec sections 6.2 and 6.3).

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AdminGate, Shell, SignOut } from './AdminPage';
import { buildFiles, download, type CsvFile, type ExportResult } from '../lib/exports';
import { closeStudy, downloadReport, makeReport, reportFileName, showReport } from '../lib/reportFlow';

interface Study {
  id: string;
  code: string;
  title: string;
  status: 'draft' | 'open' | 'closed';
  params: {
    training_seconds: number;
    max_training_rounds: number | null;
    test_rounds: number;
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
  accidents: number;
  counted_test_rounds: number;
  phase: 'not started' | 'train' | 'test' | 'done';
  playing: boolean;
  last_activity_at: string;
}

interface Progress {
  test_rounds: number;
  players: PlayerRow[];
  totals: { joined: number; playing: number; in_test: number; done: number };
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
    if (!window.confirm('Close the study? Nobody can join or play any more, submissions close, and the final report is made.')) return;
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
            Training {p.training_seconds} s{p.max_training_rounds ? ` or ${p.max_training_rounds} rounds` : ''}, then{' '}
            {p.test_rounds} counted test rounds. Time limit {p.ranges.trip_seconds?.min} to {p.ranges.trip_seconds?.max} s
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

      <Exports id={id} />

      <Reports id={id} code={study.code} version={reportsVersion} />

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Students</h2>
        <Switch
          checked={study.data_released}
          onChange={(v) => setFlag('data_released', v)}
          label="Release data to students"
          help="game_train.csv and game_test.csv become downloadable on the submission page. Turn this on when you announce the split."
        />
        <Switch
          checked={study.submissions_open}
          onChange={(v) => setFlag('submissions_open', v)}
          label="Submissions open"
          help="Teams can upload predictions. Closing the study also closes submissions."
        />
        <p className="text-sm">
          Submission page for teams:{' '}
          <a href={`/s/${study.code}/submit`} target="_blank" rel="noreferrer" className="font-mono text-blue-700 underline">
            {window.location.host}/s/{study.code}/submit
          </a>
        </p>
      </section>
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

const PHASE_STYLE: Record<PlayerRow['phase'], string> = {
  'not started': 'bg-slate-100 text-slate-600',
  train: 'bg-sky-100 text-sky-800',
  test: 'bg-amber-100 text-amber-900',
  done: 'bg-green-100 text-green-800',
};

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
            <Total label="In test" value={data.totals.in_test} />
            <Total label="Done" value={data.totals.done} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2">Player</th><th>Device</th><th>Country</th><th>Rounds</th><th>Accidents</th>
                  <th>Phase</th><th>Test rounds</th><th>Last activity</th>
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
                    <td className="tabular-nums">{r.accidents}</td>
                    <td><span className={`rounded px-2 py-0.5 text-xs ${PHASE_STYLE[r.phase]}`}>{r.phase}</span></td>
                    <td className="tabular-nums">{r.counted_test_rounds} / {data.test_rounds}</td>
                    <td className="text-slate-600">{ago(r.last_activity_at, updated)}</td>
                  </tr>
                ))}
                {data.players.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-4 text-slate-500">Nobody has joined yet.</td></tr>
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

function Exports({ id }: { id: string }) {
  const [result, setResult] = useState<{ x: ExportResult; files: CsvFile[]; at: Date } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc('mlg_admin_export', { p_id: id });
    setBusy(false);
    if (error) return setError(error.message);
    const x = data as ExportResult;
    setResult({ x, files: buildFiles(x), at: new Date() });
  }

  const c = result?.x.counts;
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Files</h2>
        <button onClick={prepare} disabled={busy} className="rounded bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {busy ? 'Preparing...' : result ? 'Prepare again' : 'Prepare files'}
        </button>
      </div>
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
      {!result && <p className="text-sm text-slate-500">Builds the class files from the rounds so far, by the rules of the data contract (section 4.4).</p>}
      {result && c && (
        <>
          <p className="text-xs text-slate-500">Prepared at {result.at.toLocaleTimeString()}. Prepare again to include newer rounds.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <ul className="space-y-1 text-sm">
              <li><b>{c.rounds_total}</b> rounds recorded, <b>{c.players_total}</b> players joined.</li>
              <li><b>{c.train_rows}</b> rows in game_train.csv, from <b>{c.players_in_train}</b> players.</li>
              <li><b>{c.test_rows}</b> rows in game_test.csv, from <b>{c.players_complete}</b> complete players.</li>
              <li className="pt-2 font-medium">Not in the student files:</li>
              <li>{c.dropped_timeout_or_breakdown} timeouts and breakdowns (rule 1)</li>
              <li>{c.dropped_interrupted} rounds interrupted by a reload</li>
              <li>{c.dropped_no_training_round} rounds of players with no counted training round (rule 3)</li>
              {c.dropped_after_done > 0 && <li>{c.dropped_after_done} rounds after a player was done</li>}
              <li>{c.players_left_out} of {c.players_total} players are in neither file (no counted training round, or no rounds).</li>
            </ul>
            <div className="space-y-2">
              {result.files.map((f) => (
                <button key={f.name} onClick={() => download(f)}
                  className="flex w-full items-center justify-between rounded border border-slate-300 px-3 py-2 text-left hover:bg-slate-50">
                  <span>
                    <span className="font-mono">{f.name}</span>
                    <span className="block text-xs text-slate-500">
                      {f.forStudents ? 'for students (after release)' : 'teacher only, never to students'}
                    </span>
                  </span>
                  <span className="text-sm text-slate-600">{f.rows} rows ↓</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
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
