import { describe as group, it, expect } from 'vitest';
import { parseSubmission, describe } from './submission';

group('parseSubmission', () => {
  it('reads a normal file, a BOM, CRLF line ends and blank lines', () => {
    const r = parseSubmission('﻿round_id,p\r\nAAAA1111,0.25\r\n\r\nBBBB2222,1e-1\r\n');
    expect(r).toEqual({ rows: [{ round_id: 'AAAA1111', p: 0.25 }, { round_id: 'BBBB2222', p: 0.1 }], errors: [] });
  });

  it('accepts a semicolon separator and quoted values', () => {
    expect(parseSubmission('"round_id";"p"\n"AAAA1111";"0.4"\n').rows).toEqual([{ round_id: 'AAAA1111', p: 0.4 }]);
  });

  it('rejects a decimal comma with a clear message, with either separator', () => {
    expect(parseSubmission('round_id;p\nAAAA1111;0,35\n').errors[0]).toMatch(/decimal comma/);
    expect(parseSubmission('round_id,p\nAAAA1111,0,35\n').errors[0]).toMatch(/decimal comma/);
  });

  it('explains a wrong header and the pandas index column', () => {
    expect(parseSubmission('id,prob\nA,0.1\n').errors[0]).toMatch(/first line must be exactly: round_id,p/);
    expect(parseSubmission(',round_id,p\n0,A,0.1\n').errors[0]).toMatch(/index=False/);
  });

  it('reports lines that cannot be read', () => {
    const r = parseSubmission('round_id,p\nA,abc\nB\nC,0.2\n');
    expect(r.rows).toEqual([]);
    expect(r.errors[0]).toMatch(/line 2: p is not a number.*line 3 has 1 values/);
  });

  it('empty files', () => {
    expect(parseSubmission('').errors).toEqual(['The file is empty.']);
    expect(parseSubmission('round_id,p\n').errors).toEqual(['The file has a header but no rows.']);
  });
});

group('server messages', () => {
  it('are worded without dashes and never mention a score', () => {
    const codes = ['closed', 'bad_team', 'bad_pin', 'wrong_pin', 'too_many', 'bad_file', 'empty', 'no_test_rounds',
      'p_out_of_range', 'duplicates', 'unknown_ids', 'missing_ids', 'looks_like_labels', 'zero_or_one', 'pin_set'];
    for (const code of codes) {
      const text = describe({ level: 'error', code, n: 2, examples: ['A', 'B'] });
      expect(text).not.toMatch(/[–—−]/);
      expect(text).not.toMatch(/log loss|score(?! between)/i);
      expect(text).not.toMatch(/^Problem:/);
    }
  });
});

group('plurals', () => {
  it('one and many', () => {
    expect(describe({ level: 'warning', code: 'zero_or_one', n: 1 })).toMatch(/^1 value of p is exactly/);
    expect(describe({ level: 'error', code: 'missing_ids', n: 6, examples: ['A'] })).toMatch(/^6 rounds of game_test.csv are missing from your file, for example A\. Did you use the latest game_test\.csv\?$/);
  });
});
