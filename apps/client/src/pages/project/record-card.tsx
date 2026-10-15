import type { ReactNode } from 'react';
import { fieldLabel, money, safeHref, workspaceDate } from './format.ts';

const ENUM_FIELDS = new Set(['status', 'eventType', 'documentType', 'category', 'priority', 'visibility', 'billable', 'severity', 'probability', 'impact', 'sentiment', 'reimbursable']);
const LINK_FIELDS = new Set(['url', 'artifactUrl', 'receiptUrl']);
/** Free text that reads as a paragraph under the record rather than an inline fact. */
const LONG_FIELDS = new Set(['description', 'note', 'body', 'message', 'mitigationPlan', 'resolutionNote', 'mitigationNote', 'responseNote', 'decisionNote']);

export type Row = Readonly<Record<string, unknown>> & { readonly id: string; readonly status?: string; readonly revision?: number };

function value(row: Row, key: string, timezone: string): ReactNode {
  const raw = row[key];
  if (LINK_FIELDS.has(key)) {
    const href = safeHref(raw);
    return href ? <a href={href} target="_blank" rel="noopener noreferrer">{String(raw)}</a> : String(raw);
  }
  if (key.endsWith('Iso')) return workspaceDate(String(raw), timezone);
  if (key === 'amountCents') return money(raw as string, row.currency as string);
  if (key === 'estimateDeltaCents') return money(raw as string, row.estimateCurrency as string);
  return ENUM_FIELDS.has(key) ? String(raw).replaceAll('_', ' ') : String(raw);
}

/**
 * One record as a row: its main field and status on the first line, short facts inline beneath,
 * free text as paragraphs, actions to the side and anything larger (an edit form) underneath.
 * Every field stays a labelled dt/dd pair; only the main field's label is visually hidden.
 */
export function RecordCard({ row, fields, primary, timezone, className, actions, extra }: {
  row: Row; fields: readonly string[]; primary?: string; timezone: string; className?: string;
  actions?: ReactNode; extra?: ReactNode;
}) {
  const present = fields.filter(key => row[key] != null && row[key] !== '');
  const main = primary ?? fields[0]!;
  const pair = (key: string, kind: string) => (
    <div key={key} className={`rf rf-${kind}`}>
      <dt className={kind === 'primary' ? 'visually-hidden' : undefined}>{fieldLabel(key)}</dt>
      <dd {...(kind === 'status' ? { 'data-status': String(row[key]) } : {})}>{value(row, key, timezone)}</dd>
    </div>
  );
  const meta = present.filter(key => key !== main && key !== 'status' && !LONG_FIELDS.has(key));
  const long = present.filter(key => key !== main && LONG_FIELDS.has(key));
  return (
    <article className={`ws-record${className ? ` ${className}` : ''}`} data-record-id={row.id}>
      <div className="ws-record-main">
        <dl className="record-head">
          {present.includes(main) && pair(main, 'primary')}
          {present.includes('status') && pair('status', 'status')}
        </dl>
        {meta.length > 0 && <dl className="record-meta">{meta.map(key => pair(key, 'meta'))}</dl>}
        {long.length > 0 && <dl className="record-long">{long.map(key => pair(key, 'long'))}</dl>}
      </div>
      {actions && <div className="ws-record-actions">{actions}</div>}
      {extra && <div className="ws-record-extra">{extra}</div>}
    </article>
  );
}
