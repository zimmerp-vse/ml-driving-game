// /admin: sign in (the existing Charming Ride account), list, create, open and close studies.
// Each study's title links to its page (/admin/study/:id): live progress, exports, switches.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { DEFAULT_CONSENT_TEXT } from '../lib/defaults';
import { closeStudy } from '../lib/reportFlow';

interface StudyRow {
  id: string;
  code: string;
  title: string;
  status: 'draft' | 'open' | 'closed';
  allow_rejoin: boolean;
  created_at: string;
  joined: number;
}

export default function AdminPage() {
  return <AdminGate>{(email) => <Studies email={email} />}</AdminGate>;
}

/** Renders children only for a signed-in admin; otherwise the sign-in form or a refusal. */
export function AdminGate({ children }: { children: (email: string) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return setIsAdmin(null);
    supabase.rpc('mlg_admin_whoami').then(({ data, error }) => setIsAdmin(!error && !!data?.is_admin));
  }, [session]);

  if (session === undefined) return <Shell>Loading...</Shell>;
  if (!session) return <SignIn />;
  if (isAdmin === null) return <Shell>Checking access...</Shell>;
  if (!isAdmin)
    return (
      <Shell>
        <p>This account ({session.user.email}) is not an admin of this app.</p>
        <SignOut />
      </Shell>
    );
  return <>{children(session.user.email ?? '')}</>;
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-4xl space-y-4 px-4 py-8">{children}</main>;
}

export function SignOut() {
  return (
    <button onClick={() => supabase.auth.signOut()} className="text-sm text-blue-700 underline">
      Sign out
    </button>
  );
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  }
  return (
    <Shell>
      <h1 className="text-2xl font-semibold">Admin sign in</h1>
      <form onSubmit={submit} className="max-w-sm space-y-3">
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="username" className="w-full rounded border border-slate-300 px-3 py-2" />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password" className="w-full rounded border border-slate-300 px-3 py-2" />
        {error && <p className="text-red-700">{error}</p>}
        <button className="rounded bg-blue-700 px-4 py-2 font-semibold text-white">Sign in</button>
      </form>
    </Shell>
  );
}

function Studies({ email }: { email: string }) {
  const [studies, setStudies] = useState<StudyRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [consent, setConsent] = useState(DEFAULT_CONSENT_TEXT);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('mlg_admin_list_studies');
    if (error) setError(error.message);
    else setStudies(data as StudyRow[]);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('mlg_admin_create_study', {
      p_title: title,
      p_consent_text: consent,
      p_params: null,
    });
    if (error) return setError(error.message);
    setTitle('');
    refresh();
  }

  async function setStatus(id: string, status: StudyRow['status']) {
    const { error } = await supabase.rpc('mlg_admin_set_status', { p_id: id, p_status: status });
    if (error) setError(error.message);
    refresh();
  }

  async function close(id: string) {
    if (!window.confirm('Close the study? Nobody can join or play any more, submissions close, and the final report is made (see the study page).')) return;
    try {
      await closeStudy(id);
    } catch (e) {
      setError((e as Error).message);
    }
    refresh();
  }

  async function setAllowRejoin(id: string, allow: boolean) {
    const { error } = await supabase.rpc('mlg_admin_set_allow_rejoin', { p_id: id, p_allow: allow });
    if (error) setError(error.message);
    refresh();
  }

  // Deleting removes the study and everything in it. With players, the code must be typed.
  async function remove(s: StudyRow) {
    let confirmCode: string | null = null;
    if (s.joined > 0) {
      confirmCode = window.prompt(
        `Delete "${s.title}" and the data of its ${s.joined} player(s)? This cannot be undone.\n\n` +
          `Type the study code ${s.code} to confirm.`,
      );
      if (confirmCode === null) return;
      if (confirmCode.trim().toUpperCase() !== s.code) return setError('The code did not match. Nothing was deleted.');
    } else if (!window.confirm(`Delete "${s.title}"? It has no players.`)) {
      return;
    }
    const { data, error } = await supabase.rpc('mlg_admin_delete_study', { p_id: s.id, p_confirm_code: confirmCode });
    if (error) setError(error.message);
    else if (!data?.deleted) setError('The code did not match. Nothing was deleted.');
    else setError(null);
    refresh();
  }

  const joinUrl = (code: string) => `${window.location.origin}/s/${code}`;
  const statusLabel = { draft: 'Not open yet', open: 'Open', closed: 'Closed' } as const;
  const created = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <Shell>
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Studies</h1>
        <span className="text-sm text-slate-500">
          {email} <SignOut />
        </span>
      </div>
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}

      <table className="w-full text-left text-sm">
        <thead className="border-b text-slate-500">
          <tr>
            <th className="py-2">Title</th><th>Created</th><th>Code</th><th>Status</th><th>Joined</th><th title="Testing: a player who is done may join again with a new nick">Replay</th><th>Links</th><th></th>
          </tr>
        </thead>
        <tbody>
          {studies.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="py-2">
                <Link to={`/admin/study/${s.id}`} className="font-medium text-blue-700 underline">{s.title}</Link>
              </td>
              <td className="whitespace-nowrap text-slate-600">{created(s.created_at)}</td>
              <td className="font-mono">{s.code}</td>
              <td>{statusLabel[s.status]}</td>
              <td>{s.joined}</td>
              <td>
                <input
                  type="checkbox"
                  checked={s.allow_rejoin}
                  onChange={(e) => setAllowRejoin(s.id, e.target.checked)}
                  title="Testing: a player who is done may join again with a new nick"
                  className="h-4 w-4"
                />
              </td>
              <td>
                <a href={joinUrl(s.code)} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                  /s/{s.code}
                </a>{' '}
                <a href={`/screen/${s.code}`} target="_blank" rel="noreferrer" className="ml-2 text-blue-700 underline">
                  QR screen
                </a>
              </td>
              <td className="space-x-2 text-right">
                {s.status !== 'open' && (
                  <button onClick={() => setStatus(s.id, 'open')} className="rounded bg-green-700 px-2 py-1 text-white">
                    Open
                  </button>
                )}
                {s.status === 'open' && (
                  <button onClick={() => close(s.id)} className="rounded bg-slate-700 px-2 py-1 text-white">
                    Close
                  </button>
                )}
                <button onClick={() => remove(s)} className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {studies.length === 0 && (
            <tr><td colSpan={8} className="py-4 text-slate-500">No studies yet.</td></tr>
          )}
        </tbody>
      </table>

      <form onSubmit={create} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">New study</h2>
        <input required placeholder="Title (shown to students)" value={title} onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded border border-slate-300 px-3 py-2" />
        <label className="block text-sm">
          Consent line (shown under the join form)
          <textarea value={consent} onChange={(e) => setConsent(e.target.value)} rows={4}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <p className="text-xs text-slate-500">
          Students play as long as they like. The split into training and test is made when you release the data
          (default: each player's last 5 counted rounds are the test, for players with at least 10). Game conditions use
          the defaults of the data contract (ranges v03).
        </p>
        <p className="text-xs text-slate-500">For a test study, tick Replay in the list: a player who is done can then join again with a new nick. Leave it off in class.</p>
        <button className="rounded bg-blue-700 px-4 py-2 font-semibold text-white">Create study</button>
        <p className="text-xs text-slate-500">Students can join after you click Open in the list.</p>
      </form>
    </Shell>
  );
}
