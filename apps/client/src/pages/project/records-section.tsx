import { useEffect, type ReactNode } from 'react';
import { useWorkspace } from './context.tsx';
import { RecordCard, type Row } from './record-card.tsx';
import type { CollectionPath } from './sections.ts';

/**
 * One record section of the workspace: heading, what is allowed now, the create form (kept in the
 * page and hidden when not allowed), the section's status line, and its records with retry.
 */
export function RecordsSection({ path, label, help, helpId, statusId, status, form, fields, recordClass, actions, emptyText, onRows }: {
  path: CollectionPath; label: string; help?: string; helpId?: string; statusId?: string; status?: string;
  form?: ReactNode; fields: readonly string[]; recordClass?: string;
  actions?: (row: Row) => ReactNode; emptyText?: string; onRows?: ReactNode;
}) {
  const { collection, load, session } = useWorkspace();
  const records = collection(path);
  useEffect(() => { void load(path); }, [load, path]);
  const noun = label.toLowerCase();
  return (
    <section id={path} className="ws-section" aria-labelledby={`${path}-title`}>
      <h2 id={`${path}-title`}>{label}</h2>
      {helpId && <p id={helpId} className="ws-help">{help}</p>}
      {form}
      {statusId && <p id={statusId} className="ws-status" role="status" aria-live="polite">{status}</p>}
      {onRows}
      <div id={`records-${path}`} className="ws-records" aria-live="polite">
        {records.state === 'loading' && <p className="ws-muted">Loading…</p>}
        {records.state === 'failed' && (
          <div className="ws-failed">
            <p>Could not load {noun}. {records.message}</p>
            <button type="button" className="button button-quiet" onClick={() => void load(path)}>Retry {noun}</button>
          </div>
        )}
        {records.state === 'ready' && records.rows.length === 0 && <p className="ws-muted">{emptyText ?? `No ${noun} recorded.`}</p>}
        {records.state === 'ready' && records.rows.map(row => (
          <RecordCard key={row.id} row={row} fields={fields} timezone={session.defaults.timezone} className={recordClass}>
            {actions?.(row)}
          </RecordCard>
        ))}
      </div>
    </section>
  );
}
