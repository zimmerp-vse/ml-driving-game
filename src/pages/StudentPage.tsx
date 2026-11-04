// /s/:code: join form, then the game, then "done". Student-facing text: plain English, no dashes.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Message } from '../App';
import { JoinForm } from '../components/JoinForm';
import { GameFrame } from '../components/GameFrame';
import { clearToken, loadToken, resume, saveToken, studyInfo, withRetry, type StudyInfo } from '../lib/api';

type View =
  | { kind: 'loading' }
  | { kind: 'not_open' }
  | { kind: 'error' }
  | { kind: 'form'; info: StudyInfo }
  | { kind: 'play'; token: string; info: StudyInfo }
  | { kind: 'done'; info: StudyInfo };

export const TEXT = {
  notOpen: 'This study is not open.',
  error: 'Something went wrong. Please check your connection and reload the page.',
  done: 'Done, thank you! You can close this page now. Please wait for the teacher.',
  loading: 'Loading...',
};

export default function StudentPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await withRetry(() => studyInfo(code));
        if (cancelled) return;
        const token = loadToken(code);
        if (token) {
          const pos = await withRetry(() => resume(token));
          if (cancelled) return;
          if (pos.ok) {
            if (pos.done) return setView({ kind: 'done', info });
            if (pos.study_status !== 'open') return setView({ kind: 'not_open' });
            return setView({ kind: 'play', token, info });
          }
          clearToken(code);
        }
        setView(info.status === 'open' ? { kind: 'form', info } : { kind: 'not_open' });
      } catch {
        if (!cancelled) setView({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  switch (view.kind) {
    case 'loading':
      return <Message text={TEXT.loading} />;
    case 'not_open':
      return <Message text={TEXT.notOpen} />;
    case 'error':
      return <Message text={TEXT.error} />;
    case 'done':
      return (
        <Message text={TEXT.done}>
          {view.info.status === 'open' && view.info.allow_rejoin && (
            <button
              onClick={() => {
                clearToken(code);
                setView({ kind: 'form', info: view.info });
              }}
              className="mx-auto mt-8 rounded-lg border border-slate-300 bg-white px-5 py-3 text-base"
            >
              Play again as a new player
            </button>
          )}
        </Message>
      );
    case 'form':
      return (
        <JoinForm
          code={code}
          info={view.info}
          onJoined={(token) => {
            saveToken(code, token);
            setView({ kind: 'play', token, info: view.info });
          }}
          onNotOpen={() => setView({ kind: 'not_open' })}
        />
      );
    case 'play':
      return (
        <GameFrame
          token={view.token}
          onDone={() => setView({ kind: 'done', info: view.info })}
          onNotOpen={() => setView({ kind: 'not_open' })}
          onError={() => setView({ kind: 'error' })}
        />
      );
  }
}
