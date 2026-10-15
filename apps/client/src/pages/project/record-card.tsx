import type { ReactNode } from 'react';
import { fieldLabel, money, safeHref, workspaceDate } from './format.ts';

const ENUM_FIELDS = new Set(['status', 'eventType', 'documentType', 'category', 'priority', 'visibility', 'billable', 'severity', 'probability', 'impact', 'sentiment']);
const LINK_FIELDS = new Set(['url', 'artifactUrl', 'receiptUrl']);

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

/** One record as a definition list of its non-empty fields, plus any actions for it. */
export function RecordCard({ row, fields, timezone, className, children }: {
  row: Row; fields: readonly string[]; timezone: string; className?: string; children?: ReactNode;
}) {
  return (
    <article className={className} data-record-id={row.id}>
      <dl className="record-fields">
        {fields.filter(key => row[key] != null && row[key] !== '').map(key => (
          <div key={key}><dt>{fieldLabel(key)}</dt><dd>{value(row, key, timezone)}</dd></div>
        ))}
      </dl>
      {children}
    </article>
  );
}
