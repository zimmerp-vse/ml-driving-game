// Calls to the database functions (mlg_*) and to /api/join.

import { supabase } from './supabase';

export type StudyStatus = 'draft' | 'open' | 'closed' | 'not_found';

export interface StudyInfo {
  status: StudyStatus;
  title?: string;
  consent_text?: string;
}

export interface Position {
  ok: true;
  respondent_id: string;
  nick: string;
  study_status: StudyStatus;
  next_attempt: number;
  counted_test_rounds: number;
  done: boolean;
}

export interface Conditions {
  tripDurationMs: number;
  carSpawnRate: number;
  obstacleSpawnRate: number;
  pedestrianSpawnRate: number;
  sceneIndex: number;
}

export interface ScheduleResult extends Position {
  from_attempt?: number;
  rounds?: Conditions[];
  fixed?: Record<string, unknown>;
}

export type Failure = { ok: false; error: string };

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Retries network failures a few times (the class shares one Wi-Fi). */
export async function withRetry<T>(f: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await f();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}

export const studyInfo = (code: string) => rpc<StudyInfo>('mlg_study_info', { p_code: code });
export const resume = (token: string) => rpc<Position | Failure>('mlg_resume', { p_token: token });
export const startSchedule = (token: string, count = 80) =>
  rpc<ScheduleResult | Failure>('mlg_start_schedule', { p_token: token, p_count: count });
export const roundStart = (token: string, attempt: number) =>
  rpc<{ ok: true } | Failure>('mlg_round_start', { p_token: token, p_attempt: attempt });

export interface RoundEndArgs {
  attempt: number;
  outcome: string;
  timeMs: number;
  scene: string;
  moneyEarned: number;
  moneyLost: number;
  moneyBalance: number;
  applied?: unknown;
}
export const roundEnd = (token: string, a: RoundEndArgs) =>
  rpc<Position | Failure>('mlg_round_end', {
    p_token: token,
    p_attempt: a.attempt,
    p_outcome: a.outcome,
    p_time_ms: Math.round(a.timeMs),
    p_scene: a.scene,
    p_money_earned: Math.round(a.moneyEarned),
    p_money_lost: Math.round(a.moneyLost),
    p_money_balance: Math.round(a.moneyBalance),
    p_applied: a.applied ?? null,
  });

export interface JoinInput {
  code: string;
  nick: string;
  sex: 'F' | 'M' | null;
  age: number | null;
}
export type JoinResult = { ok: true; respondent_id: string; token: string } | Failure;

export async function join(input: JoinInput): Promise<JoinResult> {
  const device = window.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'mouse';
  const res = await fetch('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...input,
      device,
      viewport_width: Math.round(window.innerWidth),
      viewport_height: Math.round(window.innerHeight),
    }),
  });
  try {
    return (await res.json()) as JoinResult;
  } catch {
    return { ok: false, error: 'server' };
  }
}

// The respondent token is kept per study code, so a reload resumes the same player.
const tokenKey = (code: string) => `mlg:token:${code.toUpperCase()}`;
export function loadToken(code: string): string | null {
  try {
    return localStorage.getItem(tokenKey(code));
  } catch {
    return null;
  }
}
export function saveToken(code: string, token: string) {
  try {
    localStorage.setItem(tokenKey(code), token);
  } catch {
    /* private mode: the player simply cannot resume after a reload */
  }
}
export function clearToken(code: string) {
  try {
    localStorage.removeItem(tokenKey(code));
  } catch {
    /* ignore */
  }
}
