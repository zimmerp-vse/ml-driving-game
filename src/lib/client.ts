// What kind of machine the player uses: the family of the operating system and of the browser.
// Only these two words are kept, never the user agent string itself. They go to the raw file
// (admin only) so that a slow or odd machine can be told apart from a bad driver.

export interface ClientInfo {
  os: 'Windows' | 'macOS' | 'iOS' | 'Android' | 'ChromeOS' | 'Linux' | 'other';
  browser: 'Chrome' | 'Edge' | 'Firefox' | 'Safari' | 'Opera' | 'Samsung' | 'other';
}

/** `touchPoints` tells an iPad from a Mac: iPadOS calls itself a Mac in the user agent. */
export function parseClient(userAgent: string, touchPoints = 0): ClientInfo {
  const ua = userAgent;
  let os: ClientInfo['os'] = 'other';
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Macintosh|Mac OS X/.test(ua)) os = touchPoints > 1 ? 'iOS' : 'macOS';
  else if (/Linux|X11/.test(ua)) os = 'Linux';

  // Order matters: Edge, Opera and Samsung Internet also say "Chrome", and Chrome says "Safari".
  let browser: ClientInfo['browser'] = 'other';
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung';
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return { os, browser };
}

export function clientInfo(): ClientInfo {
  if (typeof navigator === 'undefined') return { os: 'other', browser: 'other' };
  return parseClient(navigator.userAgent ?? '', navigator.maxTouchPoints ?? 0);
}
