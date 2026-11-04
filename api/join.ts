// Vercel function POST /api/join.
//
// Adds the player's country, read from Vercel's `x-vercel-ip-country` header (derived
// by the platform from the connection), and forwards the join to Supabase with the
// server-only secret key. The IP address is never read, stored or logged here.
//
// Kept self-contained (no relative imports) so Vercel can run it as-is.

export interface JoinEnv {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

export interface JoinRequestBody {
  code: string;
  nick: string;
  sex: 'F' | 'M' | null;
  age: number | null;
  device: 'touch' | 'mouse';
  viewport_width: number;
  viewport_height: number;
}

const MAX_BODY_BYTES = 2048;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const intOrNull = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** Validates the browser's request; returns the cleaned body or null. */
export function parseJoinBody(raw: unknown): JoinRequestBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.code !== 'string' || !/^[A-Za-z0-9]{4,12}$/.test(b.code)) return null;
  if (typeof b.nick !== 'string' || b.nick.length > 100) return null;
  if (b.sex !== null && b.sex !== 'F' && b.sex !== 'M') return null;
  if (b.age !== null && intOrNull(b.age, 15, 99) === null) return null;
  if (b.device !== 'touch' && b.device !== 'mouse') return null;
  return {
    code: b.code,
    nick: b.nick,
    sex: b.sex as JoinRequestBody['sex'],
    age: b.age as number | null,
    device: b.device,
    viewport_width: intOrNull(b.viewport_width, 0, 10000) ?? 0,
    viewport_height: intOrNull(b.viewport_height, 0, 10000) ?? 0,
  };
}

/** Two-letter country from the platform header, or null (unknown, Tor, missing). */
export function countryFromHeader(value: string | null): string | null {
  const c = (value ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : null;
}

export async function handleJoin(request: Request, env: JoinEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return json(500, { ok: false, error: 'server_not_configured' });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { ok: false, error: 'invalid_input' });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, { ok: false, error: 'invalid_input' });
  }
  const body = parseJoinBody(raw);
  if (!body) return json(400, { ok: false, error: 'invalid_input' });

  const country = countryFromHeader(request.headers.get('x-vercel-ip-country'));

  const key = env.SUPABASE_SECRET_KEY;
  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
  // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys do not.
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;

  let upstream: Response;
  try {
    upstream = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/mlg_join_study`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_code: body.code,
        p_nick: body.nick,
        p_sex: body.sex,
        p_age: body.age,
        p_device: body.device,
        p_viewport_width: body.viewport_width,
        p_viewport_height: body.viewport_height,
        p_country: country,
      }),
    });
  } catch {
    return json(502, { ok: false, error: 'server' });
  }
  if (!upstream.ok) {
    // Log only the status; never the request (it is not personal, but keep logs empty of it).
    console.error('mlg_join_study failed with status', upstream.status);
    return json(502, { ok: false, error: 'server' });
  }
  const result = (await upstream.json()) as { ok: boolean; error?: string; respondent_id?: string; token?: string };
  if (!result.ok) return json(200, { ok: false, error: result.error ?? 'server' });
  return json(200, { ok: true, respondent_id: result.respondent_id, token: result.token });
}

export async function POST(request: Request): Promise<Response> {
  return handleJoin(request, {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });
}
