// The embedded game. Gets a schedule from the server, sends INIT, reports every round.
// Players play as long as they like (data contract v07). Between rounds a small bar shows their
// rounds and time with a Menu button; every 10 rounds the menu opens by itself to thank them.
// The menu shows their numbers and lets them say "I'm done", which ends their game (QUIT).
// Student-facing text: plain English, no dashes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { GAME_ORIGIN, GAME_URL } from '../lib/defaults';
import {
  finishPlaying, roundEnd, roundStart, startSchedule, withRetry,
  type PlayerStats, type Position, type ScheduleResult,
} from '../lib/api';
import { Message } from '../App';
import { ControlsHint } from './ControlsHint';
import { StatsGrid, minutesPlayed, roundsText } from './PlayerStats';

const SOURCE = 'dash-delivery';
const PROTOCOL_VERSION = 1;
const TOTAL_ROUNDS = 100; // per schedule; a new one is fetched when the game runs out
const CHECK_IN_EVERY = 10;

type Session = Required<Pick<ScheduleResult, 'from_attempt' | 'rounds' | 'fixed' | 'nick' | 'respondent_id'>>;

export function GameFrame({
  token,
  onDone,
  onNotOpen,
  onError,
}: {
  token: string;
  onDone: (position?: Position) => void;
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
  // Between rounds: the player's numbers, and the menu ('menu' opened by the player, 'checkin'
  // opened by itself every 10 rounds).
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [minRounds, setMinRounds] = useState(10);
  const [between, setBetween] = useState(false);
  const [panel, setPanel] = useState<null | 'menu' | 'checkin'>(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const [finishing, setFinishing] = useState(false);
  const callbacks = useRef({ onDone, onNotOpen, onError });
  callbacks.current = { onDone, onNotOpen, onError };

  const post = useCallback((type: string, payload?: unknown) => {
    iframeRef.current?.contentWindow?.postMessage({ source: SOURCE, type, version: PROTOCOL_VERSION, payload }, GAME_ORIGIN);
  }, []);

  const finish = useCallback(
    (how: 'done' | 'not_open' | 'error', position?: Position) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      post('QUIT');
      if (how === 'done') callbacks.current.onDone(position);
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
      if (s.done) return finish('done', s);
      if (s.study_status !== 'open' || !s.rounds) return finish('not_open');
      const next: Session = {
        from_attempt: s.from_attempt!,
        rounds: s.rounds,
        fixed: s.fixed ?? {},
        nick: s.nick,
        respondent_id: s.respondent_id,
      };
      sessionRef.current = next;
      if (s.stats) setStats(s.stats);
      if (s.min_rounds) setMinRounds(s.min_rounds);
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
      difficulty: { ...s.fixed, totalRounds: TOTAL_ROUNDS, schedule: s.rounds, safeFinish: true },
      ui: { showQuitButton: false, autoStart: true, showRoundTotal: false, timeRing: true },
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

  const keepDriving = useCallback(() => {
    setPanel(null);
    focusGame();
  }, [focusGame]);

  const imDone = useCallback(async () => {
    setFinishing(true);
    try {
      const r = await withRetry(() => finishPlaying(token));
      if (r.ok) finish('done', r);
      else finish('error');
    } catch {
      finish('error');
    }
  }, [token, finish]);

  // If a key press ever lands on this page instead of the game, move focus back into the game.
  useEffect(() => {
    if (!started) return;
    const onKey = () => {
      if (!panelRef.current) focusGame();
    };
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
        setBetween(false);
        setPanel(null);
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
          if (r.ok && r.done) return finish('done', r);
          if (!r.ok) {
            if (r.error === 'unknown_token') finish('error');
            return;
          }
          setStats(r.stats);
          setBetween(true);
          if (r.stats.rounds > 0 && r.stats.rounds % CHECK_IN_EVERY === 0) setPanel('checkin');
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
        // Landscape: the poster fills the screen, controls on a dark panel over its lower part.
        // Portrait (phones): the poster as a banner on top, controls below.
        <div className="fixed inset-0 z-10 overflow-y-auto bg-slate-950 text-white">
          <img
            src="/img/poster-1600.jpg"
            srcSet="/img/poster-900.jpg 900w, /img/poster-1600.jpg 1600w"
            sizes="100vw"
            alt="Dash Delivery"
            className="w-full object-cover object-top portrait:aspect-video landscape:absolute landscape:inset-0 landscape:h-full"
          />
          <div className="pointer-events-none absolute inset-0 hidden bg-gradient-to-b from-transparent via-transparent to-slate-950/80 landscape:block" />
          <div className="relative flex justify-center px-4 py-6 landscape:min-h-full landscape:items-end landscape:pb-[6vh]">
            <div className="w-full max-w-md space-y-6 rounded-2xl text-center landscape:bg-slate-950/80 landscape:p-6 landscape:shadow-2xl landscape:backdrop-blur-sm">
              {session && (
                <p className="text-lg">
                  You play as <span className="font-semibold text-orange-300">{session.nick}</span>
                </p>
              )}
              <ControlsHint touch={!!touch} />
              <button
                onClick={start}
                autoFocus
                className="w-full rounded-lg bg-orange-500 px-6 py-4 text-xl font-semibold text-white shadow-lg shadow-orange-900/40 active:scale-95"
              >
                Start driving
              </button>
            </div>
          </div>
        </div>
      )}
      {started && between && !panel && stats && (
        <div className="fixed bottom-3 left-3 z-10 flex items-center gap-3 rounded-full bg-slate-950/85 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-lg">
          <span className="tabular-nums">
            {roundsText(stats.rounds)} · {minutesPlayed(stats.seconds)}
          </span>
          <button onClick={() => setPanel('menu')} className="rounded-full bg-orange-500 px-4 py-1.5 font-semibold active:scale-95">
            Menu
          </button>
        </div>
      )}
      {panel && stats && (
        <div className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-slate-950/90 p-4 text-white">
          <div className="w-full max-w-sm space-y-5 rounded-2xl bg-slate-900 p-6 text-center shadow-2xl">
            <h2 className="text-xl font-semibold">
              {panel === 'checkin' ? `Thank you for playing ${stats.rounds} rounds!` : 'Your game so far'}
            </h2>
            <StatsGrid stats={stats} dark />
            {panel === 'checkin' && <p>Would you like to play some more?</p>}
            <div className="space-y-3">
              <button
                onClick={keepDriving}
                autoFocus
                className="w-full rounded-lg bg-orange-500 px-6 py-3 text-lg font-semibold active:scale-95"
              >
                Keep driving
              </button>
              <button
                onClick={imDone}
                disabled={finishing}
                className="w-full rounded-lg border border-slate-500 px-6 py-3 text-lg disabled:opacity-50"
              >
                {finishing ? 'Saving...' : "I'm done"}
              </button>
            </div>
            {stats.delivered + stats.crashes < minRounds && (
              <p className="text-sm text-slate-300">
                If you can, please play at least {minRounds} rounds. More rounds give the class more data.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
