// The embedded game. Gets a schedule from the server, sends INIT, reports every round,
// and sends QUIT when the server says the player is done (app_spec section 5).
// No timer and no phase is shown: the student just drives.

import { useCallback, useEffect, useRef, useState } from 'react';
import { GAME_ORIGIN, GAME_URL } from '../lib/defaults';
import { roundEnd, roundStart, startSchedule, withRetry, type ScheduleResult } from '../lib/api';
import { Message } from '../App';
import { ControlsHint } from './ControlsHint';

const SOURCE = 'dash-delivery';
const PROTOCOL_VERSION = 1;
const TOTAL_ROUNDS = 80;

type Session = Required<Pick<ScheduleResult, 'from_attempt' | 'rounds' | 'fixed' | 'nick' | 'respondent_id'>>;

export function GameFrame({
  token,
  onDone,
  onNotOpen,
  onError,
}: {
  token: string;
  onDone: () => void;
  onNotOpen: () => void;
  onError: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const finishedRef = useRef(false);
  // Round calls run one after another, so round_end never overtakes its round_start.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  // The game is started only after the student clicks "Start driving": that click is what
  // lets the browser (Safari in particular) move keyboard focus into the game, and the first
  // round's clock does not run while the student is still reading.
  const [started, setStarted] = useState(false);
  const readyRef = useRef(false);
  const startedRef = useRef(false);
  const initSentRef = useRef(false);
  const callbacks = useRef({ onDone, onNotOpen, onError });
  callbacks.current = { onDone, onNotOpen, onError };

  const post = useCallback((type: string, payload?: unknown) => {
    iframeRef.current?.contentWindow?.postMessage({ source: SOURCE, type, version: PROTOCOL_VERSION, payload }, GAME_ORIGIN);
  }, []);

  const finish = useCallback(
    (how: 'done' | 'not_open' | 'error') => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      post('QUIT');
      if (how === 'done') callbacks.current.onDone();
      else if (how === 'not_open') callbacks.current.onNotOpen();
      else callbacks.current.onError();
    },
    [post],
  );

  // Ask the server where the player is and for the schedule of the next rounds.
  const load = useCallback(async () => {
    try {
      const s = await withRetry(() => startSchedule(token, TOTAL_ROUNDS));
      if (!s.ok) return finish('error');
      if (s.done) return finish('done');
      if (s.study_status !== 'open' || !s.rounds) return finish('not_open');
      const next: Session = {
        from_attempt: s.from_attempt!,
        rounds: s.rounds,
        fixed: s.fixed ?? {},
        nick: s.nick,
        respondent_id: s.respondent_id,
      };
      sessionRef.current = next;
      readyRef.current = false;
      initSentRef.current = false;
      startedRef.current = false;
      setStarted(false);
      setSession(next);
      setFrameKey((k) => k + 1); // a fresh iframe for a fresh schedule
    } catch {
      finish('error');
    }
  }, [token, finish]);

  useEffect(() => {
    finishedRef.current = false;
    load();
  }, [load]);

  // Send INIT once the game is READY and the student has clicked "Start driving".
  const sendInit = useCallback(() => {
    const s = sessionRef.current;
    if (!s || !readyRef.current || !startedRef.current || initSentRef.current) return;
    initSentRef.current = true;
    post('INIT', {
      session: { sessionId: s.respondent_id },
      player: { nickname: s.nick },
      difficulty: { ...s.fixed, totalRounds: TOTAL_ROUNDS, schedule: s.rounds },
      ui: { showQuitButton: false, autoStart: true, showRoundTotal: false },
    });
  }, [post]);

  const focusGame = useCallback(() => {
    iframeRef.current?.focus();
    iframeRef.current?.contentWindow?.focus();
  }, []);

  const start = useCallback(() => {
    startedRef.current = true;
    setStarted(true);
    focusGame(); // inside the click, so the browser allows it
    sendInit();
  }, [focusGame, sendInit]);

  // If a key press ever lands on this page instead of the game, move focus back into the game.
  useEffect(() => {
    if (!started) return;
    const onKey = () => focusGame();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, focusGame]);

  const enqueue = useCallback((task: () => Promise<void>) => {
    queueRef.current = queueRef.current.then(task).catch((e) => console.warn('round call failed', e));
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== GAME_ORIGIN || e.source !== iframeRef.current?.contentWindow) return;
      const m = e.data;
      if (!m || m.source !== SOURCE) return;
      const s = sessionRef.current;
      if (!s || finishedRef.current) return;

      if (m.type === 'READY') {
        readyRef.current = true;
        sendInit();
      } else if (m.type === 'ROUND_START') {
        const attempt = s.from_attempt + m.payload.round - 1;
        enqueue(async () => {
          const r = await withRetry(() => roundStart(token, attempt));
          if (!r.ok && r.error === 'not_open') finish('not_open');
        });
      } else if (m.type === 'ROUND_END') {
        const p = m.payload;
        const attempt = s.from_attempt + p.round - 1;
        enqueue(async () => {
          const r = await withRetry(() =>
            roundEnd(token, {
              attempt,
              outcome: p.outcome,
              timeMs: p.timeMs,
              scene: p.scene,
              moneyEarned: p.moneyEarned,
              moneyLost: p.moneyLost,
              moneyBalance: p.moneyBalance,
              applied: p.applied,
            }),
          );
          if (r.ok && r.done) finish('done');
          else if (!r.ok && r.error === 'unknown_token') finish('error');
        });
      } else if (m.type === 'GAME_END') {
        // The game ran out of rounds before the player was done: start again with a new schedule.
        enqueue(async () => {
          if (!finishedRef.current) await load();
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [token, sendInit, enqueue, finish, load]);

  // Safari can size the game's canvas before the iframe is laid out, leaving it stretched
  // (only the sky visible). Changing the iframe's height by 1px and back gives the game a
  // 'resize' event, so it measures again. Done twice, shortly after load.
  const [nudged, setNudged] = useState(false);
  const onFrameLoad = useCallback(() => {
    for (const at of [300, 1500]) {
      setTimeout(() => setNudged(true), at);
      setTimeout(() => setNudged(false), at + 150);
    }
  }, []);

  if (!session) return <Message text="Loading the game..." />;

  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  return (
    <>
      <iframe
        key={frameKey}
        ref={iframeRef}
        src={GAME_URL}
        title="Driving game"
        allow="autoplay; fullscreen"
        onLoad={onFrameLoad}
        style={{ height: nudged ? 'calc(100dvh - 1px)' : '100dvh' }}
        className="fixed inset-0 w-screen border-0 bg-black"
      />
      {!started && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900 px-4 text-white">
          <div className="w-full max-w-md space-y-8 text-center">
            <ControlsHint touch={!!touch} />
            <button
              onClick={start}
              autoFocus
              className="w-full rounded-lg bg-orange-500 px-6 py-4 text-xl font-semibold text-white active:scale-95"
            >
              Start driving
            </button>
          </div>
        </div>
      )}
    </>
  );
}
