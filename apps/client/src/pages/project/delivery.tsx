import type { FormEvent } from 'react';
import { useCollection, useSectionAction, useWorkspace, type Collection } from './context.tsx';
import { CreatePanel, RecordsSection } from './records-section.tsx';
import { optional } from './format.ts';
import { Input, Select, TextArea, type Choice } from './inputs.tsx';
import type { Row } from './record-card.tsx';
import type { CollectionPath } from './sections.ts';

/**
 * Choices for a select from another section's records. When those records failed to load, the
 * select says so and offers a retry instead of silently showing no choices.
 */
export function RecordChoice({ label, name, empty, path, filter, retryId, retryText, unavailable }: {
  label: string; name: string; empty: string; path: CollectionPath; filter?: (row: Row) => boolean;
  retryId: string; retryText: string; unavailable: string;
}) {
  const { load } = useWorkspace();
  // The choices may come from another tab's records, so load them here if nothing has yet.
  const records: Collection = useCollection(path);
  const rows = records.state === 'ready' ? records.rows.filter(filter ?? (() => true)) : [];
  const choices: Choice[] = [{ value: '', label: records.state === 'failed' ? unavailable : empty },
    ...rows.map(row => ({ value: row.id, label: String(row.title ?? row.id) }))];
  return (
    <Select label={label} name={name} choices={choices} defaultValue=""
      extra={records.state === 'failed' && (
        <button id={retryId} type="button" className="button button-quiet" onClick={() => void load(path)}>{retryText}</button>
      )} />
  );
}

export function Readiness() {
  const deliverables = useCollection('deliverables'), feedback = useCollection('feedback');
  let text: string;
  if (deliverables.state !== 'ready' || feedback.state !== 'ready') text = 'Readiness unavailable until both delivery sections load. Retry the failed section.';
  else {
    const unaccepted = deliverables.rows.filter(row => row.status !== 'accepted').length;
    const open = feedback.rows.filter(row => row.status === 'open').length;
    text = (deliverables.rows.length === 0 ? 'Blocked: no deliverables.'
      : unaccepted || open ? `Blocked: ${unaccepted} unaccepted deliverable(s), ${open} open feedback record(s).`
      : 'Ready: all deliverables accepted and no open feedback.') + ' The server rechecks this condition when delivering or archiving a delivered project.';
  }
  const ready = text.startsWith('Ready');
  return (
    <section id="delivery-readiness" className="ws-section" aria-labelledby="delivery-readiness-title">
      <h2 id="delivery-readiness-title">Delivery readiness</h2>
      <p className="ws-help">Delivery and delivered-project archival require at least one deliverable, every deliverable accepted, and no open feedback.</p>
      <p id="delivery-readiness-status" className={`ws-readiness${ready ? ' ws-readiness-ready' : ''}`} role="status" aria-live="polite">{text}</p>
    </section>
  );
}

type Kind = 'deliverables' | 'feedback';
function can(kind: Kind, action: 'create' | 'act', status: string): boolean {
  const states = kind === 'feedback' ? ['estimated', 'approved', 'in_progress', 'on_hold', 'delivered']
    : action === 'act' ? ['approved', 'in_progress', 'on_hold', 'delivered'] : ['approved', 'in_progress'];
  return states.includes(status);
}

function DeliverySection({ kind }: { kind: Kind }) {
  const { project, write } = useWorkspace();
  const { status, busy, run } = useSectionAction(kind);
  const singular = kind === 'deliverables' ? 'deliverable' : 'feedback';
  const allowed = can(kind, 'create', project.status), canAct = can(kind, 'act', project.status);
  const help = allowed ? `Create and manage ${kind}.`
    : canAct ? 'Submission is unavailable in this project state. Existing records can still be acted on.'
    : 'Records are read-only in this project state.';

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    const body = kind === 'deliverables'
      ? { title: data.get('title'), artifactUrl: data.get('artifactUrl'), milestoneId: optional(data.get('milestoneId')) }
      : { author: data.get('author'), sentiment: data.get('sentiment'), message: data.get('message'), deliverableId: optional(data.get('deliverableId')) };
    void run(async () => { await write('POST', kind, { id: crypto.randomUUID(), ...body }); form.reset(); },
      kind === 'deliverables' ? 'Deliverable submitted.' : 'Feedback added.');
  }
  function act(row: Row, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => write('POST', `${kind}/${encodeURIComponent(row.id)}/${kind === 'deliverables' ? 'accept' : 'address'}`,
      kind === 'feedback' ? { responseNote: optional(data.get('responseNote')) } : {}),
    kind === 'deliverables' ? 'Deliverable accepted.' : 'Feedback addressed.');
  }

  return (
    <RecordsSection path={kind} label={kind === 'deliverables' ? 'Deliverables' : 'Feedback'} help={help} helpId={`${singular}-delivery-help`}
      statusId={`${singular}-delivery-status`} status={status} recordClass="delivery-record"
      fields={kind === 'deliverables'
        ? ['title', 'milestoneId', 'artifactUrl', 'status', 'submittedAtIso', 'acceptedAtIso']
        : ['author', 'deliverableId', 'sentiment', 'message', 'status', 'receivedAtIso', 'addressedBy', 'addressedAtIso', 'responseNote']}
      primary={kind === 'feedback' ? 'message' : undefined}
      form={kind === 'deliverables' ? (
        <CreatePanel summary="New deliverable" allowed={allowed}>
        <form id="create-deliverable" className="ws-form" onSubmit={create}>
          <Input label="Title" name="title" maxLength={160} required />
          <Input label="HTTP(S) artifact URL" name="artifactUrl" type="url" maxLength={2048} required />
          <RecordChoice label="Milestone (optional)" name="milestoneId" empty="No milestone" path="milestones"
            retryId="retry-delivery-milestones" retryText="Retry milestone choices" unavailable="Milestones unavailable — retry to select" />
          <div className="form-actions"><button className="button button-primary" disabled={busy}>Submit deliverable</button></div>
        </form>
        </CreatePanel>
      ) : (
        <CreatePanel summary="New feedback" allowed={allowed}>
        <form id="create-feedback" className="ws-form" onSubmit={create}>
          <RecordChoice label="Deliverable (optional)" name="deliverableId" empty="No deliverable" path="deliverables"
            retryId="retry-feedback-deliverables" retryText="Retry deliverable choices" unavailable="Deliverables unavailable — retry to select" />
          <Input label="Author/source" name="author" maxLength={120} required />
          <Select label="Sentiment" name="sentiment" choices={['positive', 'neutral', 'negative']} defaultValue="neutral" />
          <TextArea label="Message" name="message" maxLength={2000} rows={4} required />
          <div className="form-actions"><button className="button button-primary" disabled={busy}>Add feedback</button></div>
        </form>
        </CreatePanel>
      )}
      actions={row => {
        if (!canAct || row.status !== (kind === 'deliverables' ? 'submitted' : 'open')) return null;
        return (
          <form className="delivery-action ws-action-form" onSubmit={event => act(row, event)}>
            {kind === 'feedback' && <Input label="Response note (optional)" name="responseNote" maxLength={500} />}
            <button className="button button-secondary" disabled={busy}>{kind === 'deliverables' ? 'Accept deliverable' : 'Address feedback'}</button>
          </form>
        );
      }}
    />
  );
}

export function Delivery() {
  return <><Readiness /><DeliverySection kind="deliverables" /><DeliverySection kind="feedback" /></>;
}
