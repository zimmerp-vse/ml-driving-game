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
  done?: number;
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
    return <main className="flex min-h-full items-center justify-center text-3xl">Unknown study code: {code}</main>;
  }

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-8 bg-white p-6 lg:flex-row lg:gap-16">
      <div
        className="aspect-square w-[min(80vw,70vh)] max-w-[720px]"
        aria-label={`QR code for ${displayUrl}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="max-w-xl space-y-6 text-center lg:text-left">
        {info?.title && <h1 className="text-4xl font-semibold lg:text-5xl">{info.title}</h1>}
        <div>
          <p className="text-2xl text-slate-600">Scan the code or open</p>
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
            <Count label="Done" value={info.done} />
          </dl>
        )}
        {offline && <p className="text-lg text-slate-400">Connection problem. Retrying...</p>}
      </div>
    </main>
  );
}

function Count({ label, value }: { label: string; value?: number }) {
  return (
    <div>
      <dt className="text-xl text-slate-500">{label}</dt>
      <dd className="text-6xl font-semibold tabular-nums">{value ?? 0}</dd>
    </div>
  );
}
