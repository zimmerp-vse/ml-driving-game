// Reading a team's predictions file in the browser, and wording the server's answers.
// Format (data contract section 5): header round_id,p; one row per round of game_test.csv;
// a semicolon separator is accepted; a decimal comma is rejected with a message saying so.
// All text is shown to students: plain English, no dashes.

export const MAX_UPLOAD_BYTES = 1_000_000;

export interface PredictionRow {
  round_id: string;
  p: number;
}

export interface ParseResult {
  rows: PredictionRow[];
  errors: string[];
}

const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1').trim();

export function parseSubmission(text: string): ParseResult {
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const numbered = lines.map((l, i) => ({ n: i + 1, l })).filter((x) => x.l.trim() !== '');
  if (numbered.length === 0) return { rows: [], errors: ['The file is empty.'] };

  const header = numbered[0].l;
  const sep = header.includes(';') && !header.includes(',') ? ';' : ',';
  const cells = header.split(sep).map((c) => unquote(c).toLowerCase());
  if (!(cells.length === 2 && cells[0] === 'round_id' && cells[1] === 'p')) {
    if (cells.length > 2 && cells.slice(-2).join() === 'round_id,p') {
      errors.push('The file has an extra first column. Save it without the index (in pandas: to_csv(..., index=False)).');
    } else {
      errors.push(`The first line must be exactly: round_id,p (your file starts with: ${header.slice(0, 60)}).`);
    }
    return { rows: [], errors };
  }

  const rows: PredictionRow[] = [];
  const bad: string[] = [];
  let decimalComma = false;
  for (const { n, l } of numbered.slice(1)) {
    const parts = l.split(sep);
    if (sep === ',' && parts.length === 3 && /^\s*"?\d+"?\s*$/.test(parts[2])) {
      decimalComma = true;
      continue;
    }
    if (parts.length !== 2) {
      bad.push(`line ${n} has ${parts.length} values instead of 2`);
      continue;
    }
    const id = unquote(parts[0]);
    const raw = unquote(parts[1]);
    if (sep === ';' && /^\d*,\d+$/.test(raw)) {
      decimalComma = true;
      continue;
    }
    const p = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(p)) {
      bad.push(`line ${n}: p is not a number (${raw.slice(0, 20)})`);
      continue;
    }
    rows.push({ round_id: id, p });
  }
  if (decimalComma) {
    errors.push('Your file uses a decimal comma (for example 0,35). Please use a decimal point (0.35) and save again.');
  }
  if (bad.length > 0) {
    errors.push(`Some lines could not be read: ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? `; and ${bad.length - 3} more` : ''}.`);
  }
  if (errors.length === 0 && rows.length === 0) errors.push('The file has a header but no rows.');
  return { rows: errors.length ? [] : rows, errors };
}

export interface ServerMessage {
  level: 'error' | 'warning' | 'info';
  code: string;
  n?: number;
  examples?: (string | null)[];
}

// "1 value of p is" / "3 values of p are".
const many = (n: number | undefined, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
const ex = (m: ServerMessage) =>
  m.examples && m.examples.length ? `, for example ${m.examples.filter(Boolean).slice(0, 3).join(', ')}` : '';

export function describe(m: ServerMessage): string {
  switch (m.code) {
    case 'closed': return 'Submissions are closed.';
    case 'bad_team': return 'Please enter a team name (1 to 40 characters).';
    case 'bad_pin': return 'The PIN must be 4 digits.';
    case 'wrong_pin': return 'Wrong PIN for this team. Use the PIN your team chose with its first upload.';
    case 'too_many': return 'Too many uploads for this team in the last hour. Please wait a little and try again.';
    case 'bad_file': return 'The file could not be read. Is it larger than 1 MB?';
    case 'empty': return 'The file has no rows.';
    case 'no_test_rounds': return 'There are no test rounds yet. Please ask the teacher.';
    case 'p_out_of_range': return `${many(m.n, 'value of p is not a number', 'values of p are not numbers')} from 0 to 1${ex(m)}.`;
    case 'duplicates': return `${many(m.n, 'round_id appears', 'round_id values appear')} more than once${ex(m)}.`;
    case 'unknown_ids': return `${many(m.n, 'round_id is', 'round_id values are')} not in game_test.csv${ex(m)}.`;
    case 'missing_ids': return `${many(m.n, 'round of game_test.csv is', 'rounds of game_test.csv are')} missing from your file${ex(m)}.`;
    case 'looks_like_labels': return 'Every p is exactly 0 or 1. These look like labels, not probabilities. Please upload probabilities.';
    case 'zero_or_one': return `${many(m.n, 'value of p is', 'values of p are')} exactly 0 or 1. This is accepted, but for scoring p is kept between 0.001 and 0.999.`;
    case 'pin_set': return 'Your team PIN is now set. Use the same team name and PIN for later uploads.';
    default: return `Problem: ${m.code}.`;
  }
}
