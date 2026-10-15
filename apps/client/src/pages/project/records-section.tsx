import { useLayoutEffect, type ReactNode } from 'react';
import { useWorkspace } from './context.tsx';
import { RecordCard, type Row } from './record-card.tsx';
import type { CollectionPath } from './sections.ts';

/**
 * A section's create form behind a "New …" button. Absent (hidden) when the project's state does
 * not allow creating; closed by default so each section opens on its records; stays open after a
 * successful create so several records can be added in a row.
 */
export function CreatePanel({ summary, allowed, children }: { summary: string; allowed: boolean; children: ReactNode }) {
  return (
    <details className="ws-create" hidden={!allowed}>
      <summary className="button button-primary">{summary}</summary>
      <div className="ws-create-body">{children}</div>
    </details>
  );
}

/**
 * One record section: heading, what is allowed now, the create panel, the section's status line,
 * and its records with loading, failure + retry and empty states. Loads its records when shown.
 */
export function RecordsSection({ path, label, help, helpId, statusId, status, form, fields, primary, recordClass, actions, extra, emptyText }: {
  path: CollectionPath; label: string; help?: string; helpId?: string; statusId?: string; status?: string;
  form?: ReactNode; fields: readonly string[]; primary?: string; recordClass?: string;
  actions?: (row: Row) => ReactNode; extra?: (row: Row) => ReactNode; emptyText?: string;
}) {
  const { collection, load, session } = useWorkspace();
  const records = collection(path);
  // A section always reloads its records when shown. It starts in the layout phase, before any
  // other effect, so figures and choices that only need the records loaded once (useCollection)
  // see this load and do not request the same records again.
  useLayoutEffect(() => { void load(path); }, [load, path]);
  const noun = label.toLowerCase();
  const count = records.state === 'ready' ? records.rows.length : null;
  return (
    <section id={path} className="ws-section" aria-labelledby={`${path}-title`}>
      <header className="ws-section-head">
        <h2 id={`${path}-title`}>{label}{count !== null && <span className="ws-count" aria-hidden="true">{count}</span>}</h2>
        {helpId && <p id={helpId} className="ws-help">{help}</p>}
      </header>
      {form}
      {statusId && <p id={statusId} className="ws-status" role="status" aria-live="polite">{status}</p>}
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
          <RecordCard key={row.id} row={row} fields={fields} primary={primary} timezone={session.defaults.timezone}
            className={recordClass} actions={actions?.(row)} extra={extra?.(row)} />
        ))}
      </div>
    </section>
  );
}
