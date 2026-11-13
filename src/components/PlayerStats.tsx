// A player's own numbers: between rounds (Menu, every 10 rounds) and on the Done screen.
// Student-facing text: plain English, no dashes.

import type { PlayerStats } from '../lib/api';

export function minutesPlayed(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m < 1 ? 'under 1 min' : `${m} min`;
}

export function roundsText(n: number): string {
  return n === 1 ? '1 round' : `${n} rounds`;
}

export function StatsGrid({ stats, dark = false }: { stats: PlayerStats; dark?: boolean }) {
  const items: [string, string][] = [
    ['Rounds', String(stats.rounds)],
    ['Delivered', String(stats.delivered)],
    ['Crashes', String(stats.crashes)],
    ['Out of time', String(stats.timeouts)],
    ['Time played', minutesPlayed(stats.seconds)],
    ['Cash', stats.cash === null ? '' : `$${stats.cash.toLocaleString('en-US')}`],
  ];
  return (
    <dl className="grid grid-cols-3 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className={`rounded-lg px-2 py-2 ${dark ? 'bg-white/10' : 'bg-slate-100'}`}>
          <dt className={`text-xs ${dark ? 'text-slate-300' : 'text-slate-500'}`}>{label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
