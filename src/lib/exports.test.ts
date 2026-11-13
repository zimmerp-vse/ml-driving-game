import { describe, it, expect } from 'vitest';
import { buildFiles, formatCell, formatNumber, toCsv, type ExportResult } from './exports';

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
