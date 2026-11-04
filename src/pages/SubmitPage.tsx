// /s/:code/submit: teams download the data (once released) and upload predictions.
// A file is accepted or rejected with reasons; no score is ever shown here.
// All text is shown to students: plain English, no dashes.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { download, toCsv, TRAIN_COLUMNS, TEST_COLUMNS } from '../lib/exports';
import { describe, MAX_UPLOAD_BYTES, parseSubmission, type PredictionRow, type ServerMessage } from '../lib/submission';
import { Message } from '../App';

interface PageData {
  status: 'draft' | 'open' | 'closed' | 'not_found';
  title?: string;
  data_released?: boolean;
  submissions_open?: boolean;
  train?: Record<string, unknown>[];
  test?: Record<string, unknown>[];
}

const TEAM_KEY = 'mlg:team';

export default function SubmitPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('mlg_submit_page', { p_code: code });
    if (error) setError(true);
    else setData(data as PageData);
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <Message text="Something went wrong. Please check your connection and reload the page." />;
  if (!data) return <Message text="Loading..." />;
  if (data.status === 'not_found') return <Message text="This study does not exist. Please check the link." />;

  return (
    <main className="mx-auto max-w-xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">{data.title}</h1>
        <p className="text-slate-600">Predictions</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">1. The data</h2>
        {data.data_released ? (
          <>
            <p className="text-slate-700">
              <b>game_train.csv</b> has the training rounds with the target <code>accident</code>.{' '}
              <b>game_test.csv</b> has the rounds you predict, without the target.
            </p>
            <div className="flex flex-wrap gap-3">
              <DownloadButton name="game_train.csv" columns={TRAIN_COLUMNS} rows={data.train ?? []} />
              <DownloadButton name="game_test.csv" columns={TEST_COLUMNS} rows={data.test ?? []} />
            </div>
          </>
        ) : (
          <p className="rounded-lg bg-slate-100 p-3 text-slate-700">The data is not released yet. Your teacher will tell you when.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">2. Upload your predictions</h2>
        <p className="text-slate-700">
          A CSV file with the header <code>round_id,p</code> and one row for every round of game_test.csv.
          <code> p</code> is the probability of an accident, a number from 0 to 1 with a decimal point.
          Your team's last accepted file counts.
        </p>
        {data.submissions_open && data.status === 'open' ? (
          <UploadForm code={code} />
        ) : (
          <p className="rounded-lg bg-slate-100 p-3 text-slate-700">
            {data.status === 'closed' ? 'Submissions are closed.' : 'Submissions are not open yet.'}
          </p>
        )}
      </section>
    </main>
  );
}

function DownloadButton({ name, columns, rows }: { name: string; columns: readonly string[]; rows: Record<string, unknown>[] }) {
  return (
    <button
      onClick={() => download({ name, content: toCsv(columns, rows), rows: rows.length, forStudents: true })}
      className="rounded-lg border border-slate-300 bg-white px-4 py-2 hover:bg-slate-50"
    >
      <span className="font-mono">{name}</span> <span className="text-sm text-slate-500">({rows.length} rows)</span>
    </button>
  );
}

function UploadForm({ code }: { code: string }) {
  const [team, setTeam] = useState(() => {
    try {
      return localStorage.getItem(TEAM_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [pin, setPin] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<PredictionRow[] | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ accepted: boolean; messages: ServerMessage[] } | null>(null);

  async function onFile(f: File | undefined) {
    setResult(null);
    setRows(null);
    setFileErrors([]);
    if (!f) return;
    setFileName(f.name);
    if (f.size > MAX_UPLOAD_BYTES) return setFileErrors(['The file is larger than 1 MB.']);
    const parsed = parseSubmission(await f.text());
    setFileErrors(parsed.errors);
    if (parsed.errors.length === 0) setRows(parsed.rows);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rows || busy) return;
    setBusy(true);
    setResult(null);
    try {
      localStorage.setItem(TEAM_KEY, team.trim());
    } catch {
      /* ignore */
    }
    const { data, error } = await supabase.rpc('mlg_submit', { p_code: code, p_team: team, p_pin: pin, p_rows: rows });
    setBusy(false);
    if (error) setResult({ accepted: false, messages: [{ level: 'error', code: 'bad_file' }] });
    else setResult(data as { accepted: boolean; messages: ServerMessage[] });
  }

  const ready = team.trim().length > 0 && /^\d{4}$/.test(pin) && rows !== null;

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <label className="block">
        <span className="font-medium">Team name</span>
        <input value={team} onChange={(e) => setTeam(e.target.value)} maxLength={40}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
      </label>
      <label className="block">
        <span className="font-medium">Team PIN (4 digits)</span>
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric"
          autoComplete="off" className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-2 font-mono tracking-widest" />
        <span className="mt-1 block text-sm text-slate-500">Your first upload sets the PIN. Later uploads need the same PIN.</span>
      </label>
      <label className="block">
        <span className="font-medium">File</span>
        <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => onFile(e.target.files?.[0])}
          className="mt-1 block w-full text-sm" />
      </label>
      {fileErrors.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-red-50 p-3 text-red-800">
          {fileErrors.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      {rows && <p className="text-sm text-slate-600">{fileName}: {rows.length} rows read.</p>}
      <button type="submit" disabled={!ready || busy}
        className="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-40">
        {busy ? 'Uploading...' : 'Upload'}
      </button>
      {result && (
        <div className={`space-y-2 rounded-lg p-3 ${result.accepted ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-800'}`}>
          <p className="font-semibold">{result.accepted ? 'Accepted. Thank you!' : 'Not accepted.'}</p>
          <ul className="space-y-1">
            {result.messages.map((m, i) => <li key={i}>{describe(m)}</li>)}
          </ul>
          {result.accepted && <p className="text-sm">The results come later, in the teacher's report.</p>}
        </div>
      )}
    </form>
  );
}
