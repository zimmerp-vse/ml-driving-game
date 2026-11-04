// Making, storing, showing and downloading reports (admin only).

import { supabase } from './supabase';
import { renderReport } from './reportHtml';
import type { ReportData } from './report';

export async function makeReport(studyId: string, kind: 'running' | 'final'): Promise<{ html: string; code: string }> {
  const { data, error } = await supabase.rpc('mlg_admin_report_data', { p_id: studyId });
  if (error) throw new Error(error.message);
  const d = data as ReportData;
  const html = renderReport(d, kind);
  const saved = await supabase.rpc('mlg_admin_save_report', { p_id: studyId, p_kind: kind, p_html: html });
  if (saved.error) throw new Error(saved.error.message);
  return { html, code: d.study_full.code };
}

/** Opens the report in a new tab (for the projector: press F11 or Ctrl+Cmd+F for full screen). */
export function showReport(html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadReport(html: string, name: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const reportFileName = (code: string, kind: string, at: Date) =>
  `report_${code}_${kind}_${at.toISOString().slice(0, 16).replace(/[-:T]/g, '')}.html`;

/** Closing a study closes submissions and makes the final report. */
export async function closeStudy(studyId: string): Promise<{ html: string; code: string }> {
  const { error } = await supabase.rpc('mlg_admin_set_status', { p_id: studyId, p_status: 'closed' });
  if (error) throw new Error(error.message);
  return makeReport(studyId, 'final');
}
