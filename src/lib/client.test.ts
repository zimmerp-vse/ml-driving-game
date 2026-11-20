import { describe, it, expect } from 'vitest';
import { parseClient } from './client';

const CASES: [string, string, number, string, string][] = [
  ['Chrome on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 0, 'Windows', 'Chrome'],
  ['Edge on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 0, 'Windows', 'Edge'],
  ['Firefox on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0', 0, 'Windows', 'Firefox'],
  ['Safari on a Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 0, 'macOS', 'Safari'],
  ['Chrome on a Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 0, 'macOS', 'Chrome'],
  ['Safari on an iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 5, 'iOS', 'Safari'],
  ['Chrome on an iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1', 5, 'iOS', 'Chrome'],
  ['Safari on an iPad, which calls itself a Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 5, 'iOS', 'Safari'],
  ['Chrome on Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', 5, 'Android', 'Chrome'],
  ['Samsung Internet', 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36', 5, 'Android', 'Samsung'],
  ['Firefox on Linux', 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 0, 'Linux', 'Firefox'],
  ['Chrome on a Chromebook', 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 0, 'ChromeOS', 'Chrome'],
  ['something unknown', 'curl/8.4.0', 0, 'other', 'other'],
];

describe('parseClient', () => {
  it.each(CASES)('%s', (_name, ua, touch, os, browser) => {
    expect(parseClient(ua, touch)).toEqual({ os, browser });
  });
});
