// /screen/:code: for the projector. Big QR code, the join address, and counts.
// No personal data. Text is read by students: plain English, no dashes.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';

interface ScreenInfo {
  status: 'draft' | 'open' | 'closed' | 'not_found';
  title?: string;
  joined?: number;
  playing?: number;
  enough_rounds?: number;
  done?: number;
  min_rounds?: number;
}

const POLL_MS = 5000;

export default function ScreenPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const joinUrl = `${window.location.origin}/s/${code}`;
  const displayUrl = joinUrl.replace(/^https?:\/\//, '');
  const [svg, setSvg] = useState('');
  const [info, setInfo] = useState<ScreenInfo | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    QRCode.toString(joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setSvg);
  }, [joinUrl]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.rpc('mlg_screen_info', { p_code: code });
      if (!alive) return;
      setOffline(!!error);
      if (!error) setInfo(data as ScreenInfo);
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [code]);

  if (info?.status === 'not_found') {
    return <main className="flex min-h-full items-center justify-center bg-slate-950 text-3xl text-white">Unknown study code: {code}</main>;
  }

  return (
    // The game artwork as background; the QR code always sits on solid white with a margin,
    // so it stays readable from the back of the room.
    <main className="relative flex min-h-full flex-col items-center justify-center gap-8 overflow-hidden bg-slate-950 p-6 text-white lg:flex-row lg:gap-16">
      <img
        src="/img/synthwave-1600.jpg"
        srcSet="/img/synthwave-900.jpg 900w, /img/synthwave-1600.jpg 1600w"
        sizes="100vw"
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 bg-slate-950/35" />
      <div className="relative rounded-3xl bg-white p-[min(3vw,3vh)] shadow-2xl">
        <div
          className="aspect-square w-[min(75vw,64vh)] max-w-[680px]"
          aria-label={`QR code for ${displayUrl}`}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div className="relative max-w-xl space-y-6 rounded-3xl bg-slate-950/75 p-8 text-center shadow-2xl backdrop-blur-sm lg:text-left">
        {info?.title && <h1 className="text-4xl font-semibold lg:text-5xl">{info.title}</h1>}
        <div>
          <p className="text-2xl text-slate-300">Scan the code or open</p>
          {/* Wrap only between the host and /s/CODE, never inside the code. */}
          <p className="font-mono text-3xl font-semibold lg:text-4xl">
            <span className="whitespace-nowrap">{window.location.host}</span>
            <wbr />
            <span className="whitespace-nowrap">/s/{code}</span>
          </p>
        </div>
        {info && info.status !== 'open' && (
          <p className="rounded-lg bg-amber-100 px-4 py-3 text-2xl text-amber-900">
            {info.status === 'closed' ? 'This study is closed.' : 'This study is not open yet.'}
          </p>
        )}
        {info && (
          <dl className="flex justify-center gap-10 lg:justify-start">
            <Count label="Joined" value={info.joined} />
            <Count label="Playing" value={info.playing} />
            <Count label={`${info.min_rounds ?? 10}+ rounds`} value={info.enough_rounds} />
            <Count label="Done" value={info.done} />
          </dl>
        )}
        {offline && <p className="text-lg text-slate-300">Connection problem. Retrying...</p>}
      </div>
    </main>
  );
}

function Count({ label, value }: { label: string; value?: number }) {
  return (
    <div>
      <dt className="text-xl text-slate-300">{label}</dt>
      <dd className="text-6xl font-semibold tabular-nums">{value ?? 0}</dd>
    </div>
  );
}
