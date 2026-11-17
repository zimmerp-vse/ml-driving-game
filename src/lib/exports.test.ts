import { describe, it, expect } from 'vitest';
import { buildFiles, buildSubmissionsFile, formatCell, formatNumber, toCsv, type ExportResult } from './exports';

describe('formatting', () => {
  it('numbers use a decimal point, no exponent, at most 6 decimals', () => {
    expect(formatNumber(26.6)).toBe('26.6');
    expect(formatNumber(0.0015)).toBe('0.0015');
    expect(formatNumber(1e-7)).toBe('0');
    expect(formatNumber(0.1234567)).toBe('0.123457');
    expect(formatNumber(7)).toBe('7');
  });

  it('missing values are empty; text with a comma or quote is quoted', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
    expect(formatCell('anna')).toBe('anna');
    expect(formatCell('a,b')).toBe('"a,b"');
    expect(formatCell('say "hi"')).toBe('"say ""hi"""');
    expect(formatCell(true)).toBe('true');
    expect(formatCell({ sceneIndex: 7 })).toBe('"{""sceneIndex"":7}"');
  });

  it('header row, one line per row, no BOM', () => {
    const csv = toCsv(['a', 'b'], [{ a: 1, b: null }, { a: 'x,y', b: 0.5 }]);
    expect(csv).toBe('a,b\n1,\n"x,y",0.5\n');
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe('buildFiles', () => {
  const x: ExportResult = {
    study: { code: 'ABC234', title: 't' },
    release: null,
    files: [
      { file: 'train', round_id: 'R1', player: 'anna', sex: 'F', age: 21, device: 'touch', country: 'CZ', attempt: 1,
        trip_seconds: 26.6, car_rate: 0.05, obstacle_rate: 0.01, pedestrian_rate: 0.002, scene: 'Snow Valley', accident: 0 },
      { file: 'test', round_id: 'R4', player: 'anna', sex: 'F', age: 21, device: 'touch', country: 'CZ', attempt: 4,
        trip_seconds: 13, car_rate: 0.1, obstacle_rate: 0.02, pedestrian_rate: 0.003, scene: 'City Night', accident: 1 },
    ],
    raw: [],
    counts: {} as ExportResult['counts'],
  };

  it('writes the contract columns per file; labels only in the teacher file', () => {
    const [train, test, labels, raw] = buildFiles(x);
    expect(train.content).toBe(
      'round_id,player,sex,age,device,country,attempt,trip_seconds,car_rate,obstacle_rate,pedestrian_rate,scene,accident\n' +
        'R1,anna,F,21,touch,CZ,1,26.6,0.05,0.01,0.002,Snow Valley,0\n',
    );
    expect(test.content).toBe(
      'round_id,player,sex,age,device,country,attempt,trip_seconds,car_rate,obstacle_rate,pedestrian_rate,scene\n' +
        'R4,anna,F,21,touch,CZ,4,13,0.1,0.02,0.003,City Night\n',
    );
    expect(test.content).not.toContain('accident');
    expect(labels.content).toBe('round_id,accident\nR4,1\n');
    expect([train.forStudents, test.forStudents, labels.forStudents, raw.forStudents]).toEqual([true, true, false, false]);
    expect(raw.name).toBe('game_raw_ABC234.csv');
  });
});

describe('buildSubmissionsFile', () => {
  const teams = [
    { team: 'Bravo', uploaded_at: '2026-11-19T10:05:00Z', rows: [{ round_id: 'R2', p: 0.5 }, { round_id: 'R1', p: 0.25 }] },
    { team: 'alpha', uploaded_at: '2026-11-19T10:00:00Z', rows: [{ round_id: 'R1', p: 0.1 }] },
  ];

  it('is one teacher-only file, sorted by team then round, with the team on every row', () => {
    const f = buildSubmissionsFile('ABC234', teams);
    expect(f.name).toBe('submissions_ABC234.csv');
    expect(f.forStudents).toBe(false);
    expect(f.rows).toBe(3);
    expect(f.content).toBe(
      'team,uploaded_at,round_id,p\n' +
      'alpha,2026-11-19T10:00:00Z,R1,0.1\n' +
      'Bravo,2026-11-19T10:05:00Z,R1,0.25\n' +
      'Bravo,2026-11-19T10:05:00Z,R2,0.5\n');
  });

  it('a team with no stored rows is skipped', () => {
    expect(buildSubmissionsFile('ABC234', [{ team: 'x', uploaded_at: 'y', rows: undefined as never }]).rows).toBe(0);
  });
});
