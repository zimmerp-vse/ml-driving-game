// Defaults for new studies. Shown to students, so: plain English, no dashes.
export const DEFAULT_CONSENT_TEXT =
  'We store your nick, sex, age, the type of device you use, the country you connect from ' +
  '(worked out from your internet connection; your IP address is not stored) and how you play each round. ' +
  'Your classmates will see this data under your nick only.';

export const GAME_URL: string =
  (import.meta.env.VITE_GAME_URL as string | undefined) ?? 'https://speedy-deliveries-theta.vercel.app/game';
export const GAME_ORIGIN = new URL(GAME_URL).origin;
