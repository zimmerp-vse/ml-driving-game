// The join form. Student-facing text: plain English, no dashes.

import { useState, type FormEvent } from 'react';
import { join, type StudyInfo } from '../lib/api';

const ERRORS: Record<string, string> = {
  nick_taken: 'This nick is already taken. Please choose another one.',
  invalid_nick: 'Your nick must have 2 to 20 characters.',
  invalid_input: 'Please check your answers.',
  full: 'This study is full.',
  server: 'Something went wrong. Please try again.',
};

type Choice = 'F' | 'M' | 'none' | '';

export function JoinForm({
  code,
  info,
  onJoined,
  onNotOpen,
}: {
  code: string;
  info: StudyInfo;
  onJoined: (token: string) => void;
  onNotOpen: () => void;
}) {
  const [nick, setNick] = useState('');
  const [sex, setSex] = useState<Choice>('');
  const [age, setAge] = useState('');
  const [ageNone, setAgeNone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = nick.trim();
  const ageNum = Number(age);
  const ageOk = ageNone || (/^\d{2}$/.test(age) && ageNum >= 15 && ageNum <= 99);
  const ready = trimmed.length >= 2 && trimmed.length <= 20 && sex !== '' && ageOk;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await join({
        code,
        nick: trimmed,
        sex: sex === 'F' || sex === 'M' ? sex : null,
        age: ageNone ? null : ageNum,
      });
      if (r.ok) return onJoined(r.token);
      if (r.error === 'not_open') return onNotOpen();
      setError(ERRORS[r.error] ?? ERRORS.server);
    } catch {
      setError(ERRORS.server);
    } finally {
      setBusy(false);
    }
  }

  const radio = (value: Choice, label: string) => (
    <label className="flex items-center gap-2 py-1">
      <input type="radio" name="sex" value={value} checked={sex === value} onChange={() => setSex(value)} className="h-5 w-5" />
      {label}
    </label>
  );

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">{info.title}</h1>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label htmlFor="nick" className="mb-1 block font-medium">
            Your nick
          </label>
          <input
            id="nick"
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            maxLength={20}
            autoComplete="off"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-lg"
          />
          <p className="mt-1 text-sm text-slate-500">2 to 20 characters. Not your real name: your classmates will see it.</p>
        </div>

        <fieldset>
          <legend className="mb-1 font-medium">Sex</legend>
          {radio('F', 'Female')}
          {radio('M', 'Male')}
          {radio('none', "I'd rather not say")}
        </fieldset>

        <div>
          <label htmlFor="age" className="mb-1 block font-medium">
            Age
          </label>
          <input
            id="age"
            inputMode="numeric"
            value={ageNone ? '' : age}
            disabled={ageNone}
            onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 2))}
            className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-lg disabled:bg-slate-100"
          />
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={ageNone} onChange={(e) => setAgeNone(e.target.checked)} className="h-5 w-5" />
            I'd rather not say
          </label>
          {!ageNone && age !== '' && !ageOk && <p className="mt-1 text-sm text-red-700">Please enter a number from 15 to 99.</p>}
        </div>

        {error && <p className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}

        <button
          type="submit"
          disabled={!ready || busy}
          className="w-full rounded-lg bg-blue-700 px-4 py-3 text-lg font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Joining...' : 'Join and start driving'}
        </button>

        <p className="text-sm leading-relaxed text-slate-600">{info.consent_text}</p>
      </form>
    </main>
  );
}
