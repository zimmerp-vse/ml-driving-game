// /admin: sign in (the existing Charming Ride account), list, create, open and close studies.
// Milestone 1 scope; live progress, exports and reports come later (app_spec section 11).

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { DEFAULT_CONSENT_TEXT } from '../lib/defaults';

interface StudyRow {
  id: string;
  code: string;
  title: string;
  status: 'draft' | 'open' | 'closed';
  created_at: string;
  joined: number;
}

export default function AdminPage() {
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
  return <Studies email={session.user.email ?? ''} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-4xl space-y-4 px-4 py-8">{children}</main>;
}

function SignOut() {
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
  const [trainingSeconds, setTrainingSeconds] = useState('600');

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
    const secs = Number(trainingSeconds);
    const { error } = await supabase.rpc('mlg_admin_create_study', {
      p_title: title,
      p_consent_text: consent,
      p_params: Number.isFinite(secs) && secs > 0 ? { training_seconds: Math.round(secs) } : null,
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

  const joinUrl = (code: string) => `${window.location.origin}/s/${code}`;

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
            <th className="py-2">Title</th><th>Code</th><th>Status</th><th>Joined</th><th>Join link</th><th></th>
          </tr>
        </thead>
        <tbody>
          {studies.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="py-2">{s.title}</td>
              <td className="font-mono">{s.code}</td>
              <td>{s.status}</td>
              <td>{s.joined}</td>
              <td>
                <a href={joinUrl(s.code)} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                  /s/{s.code}
                </a>
              </td>
              <td className="space-x-2 text-right">
                {s.status !== 'open' && (
                  <button onClick={() => setStatus(s.id, 'open')} className="rounded bg-green-700 px-2 py-1 text-white">
                    Open
                  </button>
                )}
                {s.status === 'open' && (
                  <button onClick={() => setStatus(s.id, 'closed')} className="rounded bg-slate-700 px-2 py-1 text-white">
                    Close
                  </button>
                )}
              </td>
            </tr>
          ))}
          {studies.length === 0 && (
            <tr><td colSpan={6} className="py-4 text-slate-500">No studies yet.</td></tr>
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
        <label className="block text-sm">
          Training time in seconds
          <input value={trainingSeconds} onChange={(e) => setTrainingSeconds(e.target.value)} inputMode="numeric"
            className="ml-2 w-24 rounded border border-slate-300 px-2 py-1" />
        </label>
        <p className="text-xs text-slate-500">Other parameters use the defaults of the data contract (5 test rounds, ranges v01).</p>
        <button className="rounded bg-blue-700 px-4 py-2 font-semibold text-white">Create (as draft)</button>
      </form>
    </Shell>
  );
}
