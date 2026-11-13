// The four files of the data contract, built from mlg_admin_export's result.
// Format (contract section 4): UTF-8 without BOM, comma separated, decimal point, header row,
// missing values as empty fields. Which rows go where is decided in the database when the
// teacher releases the data (mlgame.split_rows, contract v07); this module only lays them out.

export const TRAIN_COLUMNS = [
  'round_id', 'player', 'sex', 'age', 'device', 'country', 'attempt',
  'trip_seconds', 'car_rate', 'obstacle_rate', 'pedestrian_rate', 'scene', 'accident',
] as const;
export const TEST_COLUMNS = TRAIN_COLUMNS.filter((c) => c !== 'accident');
export const LABEL_COLUMNS = ['round_id', 'accident'] as const;
// Contract section 3, in its order.
export const RAW_COLUMNS = [
  'study_code', 'player', 'sex', 'age', 'device', 'country', 'viewport_width', 'viewport_height',
  'joined_at', 'finished_at', 'attempt', 'counted', 'round_started_at', 'round_ended_at',
  'trip_seconds', 'car_rate', 'obstacle_rate', 'pedestrian_rate', 'scene', 'outcome', 'time_ms',
  'money_earned', 'money_lost', 'money_balance', 'applied',
] as const;

type Row = Record<string, unknown>;

export interface ExportCounts {
  rounds_total: number;
  train_rows: number;
  test_rows: number;
  dropped_timeout_or_breakdown: number;
  dropped_unfinished: number;
  dropped_after_cutoff: number;
  players_total: number;
  players_in_test: number;
  players_in_train: number;
  players_only_train: number;
  players_left_out: number;
}

/** A stored release of the data: its settings and the counts it was made with. */
export interface Release {
  number: number;
  created_at: string;
  cutoff: string;
  test_rounds: number;
  min_rounds: number;
  counts: ExportCounts;
}

export interface ExportResult {
  study: { code: string; title: string };
  /** The release the files come from; null before the first release (a preview with the defaults). */
  release: Release | null;
  files: (Row & { file: 'train' | 'test' })[];
  raw: Row[];
  counts: ExportCounts;
}

/** A number with a decimal point and no exponent; at most 6 decimals. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'number') s = formatNumber(v);
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  // RFC 4180 quoting when needed (a nick may contain a comma or a quote).
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: readonly string[], rows: Row[]): string {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => formatCell(r[c])).join(','));
  return lines.join('\n') + '\n';
}

export interface CsvFile {
  name: string;
  content: string;
  rows: number;
  forStudents: boolean;
}

export function buildFiles(x: ExportResult): CsvFile[] {
  const train = x.files.filter((r) => r.file === 'train');
  const test = x.files.filter((r) => r.file === 'test');
  return [
    { name: 'game_train.csv', content: toCsv(TRAIN_COLUMNS, train), rows: train.length, forStudents: true },
    { name: 'game_test.csv', content: toCsv(TEST_COLUMNS, test), rows: test.length, forStudents: true },
    { name: 'game_labels.csv', content: toCsv(LABEL_COLUMNS, test), rows: test.length, forStudents: false },
    { name: `game_raw_${x.study.code}.csv`, content: toCsv(RAW_COLUMNS, x.raw), rows: x.raw.length, forStudents: false },
  ];
}

export function download(file: CsvFile) {
  const blob = new Blob([file.content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
