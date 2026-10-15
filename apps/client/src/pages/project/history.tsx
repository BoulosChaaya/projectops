import { useEffect, type FormEvent } from 'react';
import { projectHistoryLabels } from '../../../../../packages/projectops/src/history.ts';
import { useSectionAction, useWorkspace } from './context.tsx';
import { workspaceDate } from './format.ts';
import { TextArea } from './inputs.tsx';

const LABELS: Readonly<Record<string, string>> = projectHistoryLabels;

/**
 * The project's history. The server records every successful action, so the list reloads after
 * each write on the page; a slower, older reload never replaces a newer one.
 */
export function History() {
  const { project, session, write, collection, load, writes } = useWorkspace();
  const { status, busy, run } = useSectionAction();
  const records = collection('activities');
  const terminal = ['cancelled', 'archived'].includes(project.status);
  useEffect(() => { void load('activities'); }, [load, writes]);

  function annotate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, summary = new FormData(form).get('summary');
    void run(async () => { await write('POST', 'activities', { summary }); form.reset(); }, 'Annotation added.');
  }

  return (
    <section id="activities" className="ws-rail" aria-labelledby="activities-title">
      <h2 id="activities-title">History{records.state === 'ready' && <span className="ws-count" aria-hidden="true">{records.rows.length}</span>}</h2>
      <p id="history-help" className="ws-help">{terminal
        ? 'History is retained. This project is read-only.'
        : 'Successful project actions are recorded automatically. Add an operator annotation for additional context.'}</p>
      <form id="create-annotation" className="ws-annotate" hidden={terminal} onSubmit={annotate}>
        <TextArea label="Annotation summary" name="summary" required maxLength={500} rows={2} />
        <button className="button button-secondary" disabled={busy}>Add annotation</button>
      </form>
      <p id="annotation-status" className="ws-status" role="status" aria-live="polite">{status}</p>
      <div id="records-activities" className="ws-history" aria-live="polite">
        {records.state === 'loading' && <p className="ws-muted">Loading history…</p>}
        {records.state === 'failed' && (
          <div className="ws-failed">
            <p>History unavailable. {records.message}</p>
            <button type="button" className="button button-quiet" onClick={() => void load('activities')}>Retry history</button>
          </div>
        )}
        {records.state === 'ready' && records.rows.length === 0 && <p className="ws-muted">No history recorded.</p>}
        {records.state === 'ready' && records.rows.map(row => (
          <article key={row.id} data-event-type={String(row.eventType)} data-activity-id={row.id}>
            <h3>{LABELS[String(row.eventType)] ?? String(row.eventType).replaceAll('_', ' ')}</h3>
            <p>{String(row.summary)}</p>
            <p className="history-metadata">{`${row.actor ? String(row.actor) : 'Actor not recorded'} · ${workspaceDate(String(row.happenedAtIso), session.defaults.timezone)}`}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

