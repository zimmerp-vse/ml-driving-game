import { describe, it, expect, vi } from 'vitest';
import { handleJoin, countryFromHeader } from '../api/join';

const env = { SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_SECRET_KEY: 'sb_secret_test' };
const body = { code: 'ABC234', nick: 'alice', sex: null, age: 21, device: 'touch', viewport_width: 390, viewport_height: 844 };

const req = (b: unknown, headers: Record<string, string> = {}, method = 'POST') =>
  new Request('https://app.example/api/join', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify(b) : undefined,
  });

describe('countryFromHeader', () => {
  it('accepts two letters, drops unknown and Tor', () => {
    expect(countryFromHeader('cz')).toBe('CZ');
    expect(countryFromHeader('XX')).toBeNull();
    expect(countryFromHeader('T1')).toBeNull();
    expect(countryFromHeader(null)).toBeNull();
    expect(countryFromHeader('CZE')).toBeNull();
  });
});

describe('handleJoin', () => {
  it('forwards to mlg_join_study with the country from the header, not from the body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, respondent_id: 'r1', token: 't1' })));
    const res = await handleJoin(req({ ...body, country: 'US' }, { 'x-vercel-ip-country': 'CZ', 'x-forwarded-for': '1.2.3.4' }), env, fetchMock as any);
    expect(await res.json()).toEqual({ ok: true, respondent_id: 'r1', token: 't1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/mlg_join_study');
    const sent = JSON.parse(init.body as string);
    expect(sent.p_country).toBe('CZ');
    expect(JSON.stringify(sent)).not.toContain('1.2.3.4');
    expect((init.headers as Record<string, string>).apikey).toBe('sb_secret_test');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('passes database refusals through', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'nick_taken' })));
    const res = await handleJoin(req(body), env, fetchMock as any);
    expect(await res.json()).toEqual({ ok: false, error: 'nick_taken' });
  });

  it('rejects bad input without calling the database', async () => {
    const fetchMock = vi.fn();
    for (const b of [{ ...body, device: 'tv' }, { ...body, age: 5 }, { ...body, code: 'x' }, { ...body, sex: 'Q' }]) {
      const res = await handleJoin(req(b), env, fetchMock as any);
      expect(res.status).toBe(400);
    }
    expect((await handleJoin(req(body, {}, 'GET'), env, fetchMock as any)).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing configuration and upstream errors', async () => {
    expect((await handleJoin(req(body), {}, vi.fn() as any)).status).toBe(500);
    const res = await handleJoin(req(body), env, (async () => new Response('x', { status: 500 })) as any);
    expect(res.status).toBe(502);
  });
});
