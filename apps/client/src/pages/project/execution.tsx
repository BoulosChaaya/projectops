import type { FormEvent, ReactNode } from 'react';
import { useSectionAction, useWorkspace } from './context.tsx';
import { RecordsSection } from './records-section.tsx';
import { optional } from './format.ts';
import { Check, Input, LEVELS, Select, TextArea } from './inputs.tsx';
import type { Row } from './record-card.tsx';
import type { ProjectRequestStatus } from '../../../../../packages/projectops/src/domain.ts';

type Kind = 'work-logs' | 'notes' | 'documents' | 'issues' | 'risks';
type Data = FormData;

interface Spec {
  readonly label: string;
  readonly singular: string;
  readonly fields: readonly string[];
  readonly create: string;
  readonly created: string;
  readonly form: ReactNode;
  readonly body: (data: Data, login: string) => Record<string, unknown>;
}

const SPECS: Readonly<Record<Kind, Spec>> = {
  'work-logs': {
    label: 'Work logs', singular: 'work log', create: 'Log work', created: 'Work logged.',
    fields: ['actor', 'minutes', 'billable', 'taskId', 'note', 'loggedAtIso'],
    form: <>
      <Input label="Task ID (optional)" name="taskId" maxLength={120} />
      <Input label="Minutes" name="minutes" type="number" min={1} max={1440} required />
      <Check label="Billable" name="billable" defaultChecked />
      <TextArea label="Note" name="note" maxLength={1000} />
    </>,
    body: (data, login) => ({ taskId: optional(data.get('taskId')), actor: login, minutes: Number(data.get('minutes')), billable: data.get('billable') === 'on', note: optional(data.get('note')) }),
  },
  notes: {
    label: 'Notes', singular: 'note', create: 'Add note', created: 'Note added.',
    fields: ['author', 'visibility', 'body', 'status', 'createdAtIso', 'archivedBy', 'archivedAtIso'],
    form: <>
      <Select label="Visibility" name="visibility" choices={['internal', 'client']} defaultValue="internal" />
      <TextArea label="Note" name="body" maxLength={2000} rows={4} required />
    </>,
    body: (data, login) => ({ author: login, visibility: data.get('visibility'), body: data.get('body') }),
  },
  documents: {
    label: 'Documents', singular: 'document', create: 'Add document link', created: 'Document link added.',
    fields: ['title', 'documentType', 'url', 'deliverableId', 'status', 'uploadedBy', 'uploadedAtIso', 'archivedBy', 'archivedAtIso'],
    form: <>
      <Input label="Title" name="title" maxLength={160} required />
      <Select label="Type" name="documentType" choices={['proposal', 'contract', 'asset', 'handoff', 'other']} defaultValue="other" />
      <Input label="HTTP(S) URL" name="url" type="url" maxLength={2048} required />
      <Input label="Deliverable ID (optional)" name="deliverableId" maxLength={120} />
    </>,
    body: (data, login) => ({ deliverableId: optional(data.get('deliverableId')), title: data.get('title'), documentType: data.get('documentType'), url: data.get('url'), uploadedBy: login }),
  },
  issues: {
    label: 'Issues', singular: 'issue', create: 'Add issue', created: 'Issue added.',
    fields: ['title', 'description', 'severity', 'owner', 'status', 'openedAtIso', 'resolutionNote', 'resolvedAtIso'],
    form: <>
      <Input label="Title" name="title" maxLength={160} required />
      <TextArea label="Description" name="description" maxLength={2000} rows={4} required />
      <Select label="Severity" name="severity" choices={LEVELS} defaultValue="medium" />
      <Input label="Owner" name="owner" maxLength={120} />
    </>,
    body: data => ({ title: data.get('title'), description: data.get('description'), severity: data.get('severity'), owner: optional(data.get('owner')) }),
  },
  risks: {
    label: 'Risks', singular: 'risk', create: 'Add risk', created: 'Risk added.',
    fields: ['title', 'description', 'probability', 'impact', 'owner', 'mitigationPlan', 'status', 'identifiedAtIso', 'mitigationNote', 'mitigatedAtIso'],
    form: <>
      <Input label="Title" name="title" maxLength={160} required />
      <TextArea label="Description" name="description" maxLength={2000} rows={4} required />
      <Select label="Probability" name="probability" choices={LEVELS} defaultValue="medium" />
      <Select label="Impact" name="impact" choices={LEVELS} defaultValue="medium" />
      <TextArea label="Mitigation plan" name="mitigationPlan" maxLength={1000} />
      <Input label="Owner" name="owner" maxLength={120} />
    </>,
    body: data => ({ title: data.get('title'), description: data.get('description'), probability: data.get('probability'), impact: data.get('impact'), mitigationPlan: optional(data.get('mitigationPlan')), owner: optional(data.get('owner')) }),
  },
};

const TERMINAL: readonly ProjectRequestStatus[] = ['cancelled', 'archived'];
function canCreate(kind: Kind, status: ProjectRequestStatus): boolean {
  if (kind === 'work-logs') return ['estimated', 'approved', 'in_progress', 'delivered'].includes(status);
  if (kind === 'notes') return !TERMINAL.includes(status);
  return ['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'].includes(status);
}

/** The one action each open record offers: resolve an issue, mitigate a risk, archive a note or document. */
const ACTION = {
  issues: { path: 'resolve', button: 'Resolve issue', note: 'Resolution note (optional)', key: 'resolutionNote', done: 'Issue resolved.', open: 'open' },
  risks: { path: 'mitigate', button: 'Mitigate risk', note: 'Mitigation note (optional)', key: 'mitigationNote', done: 'Risk mitigated.', open: 'open' },
  notes: { path: 'archive', button: 'Archive note', note: undefined, key: undefined, done: 'Note archived.', open: 'active' },
  documents: { path: 'archive', button: 'Archive document', note: undefined, key: undefined, done: 'Document archived.', open: 'active' },
} as const;

function ExecutionSection({ kind }: { kind: Kind }) {
  const { project, session, write } = useWorkspace();
  const { status, busy, run } = useSectionAction(kind);
  const spec = SPECS[kind];
  const allowed = canCreate(kind, project.status);
  const canAct = !TERMINAL.includes(project.status);
  const id = kind === 'work-logs' ? 'work-log' : spec.singular;
  const capital = spec.singular[0]!.toUpperCase() + spec.singular.slice(1);
  const help = allowed ? `Add and manage ${spec.label.toLowerCase()}.`
    : kind === 'work-logs' && project.status === 'on_hold' ? 'Work logging is paused while the project is on hold.'
    : canAct ? `New ${spec.singular} records are unavailable in this project state.`
    : `${capital} records are read-only in this project state.`;

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = { id: crypto.randomUUID(), ...spec.body(new FormData(form), session.login) };
    void run(async () => { await write('POST', kind, body); form.reset(); }, spec.created);
  }
  function act(row: Row, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (kind === 'work-logs') return;
    const action = ACTION[kind], data = new FormData(event.currentTarget);
    const body = action.key ? { [action.key]: optional(data.get('actionNote')) } : { archivedBy: session.login };
    void run(() => write('POST', `${kind}/${encodeURIComponent(row.id)}/${action.path}`, body), action.done);
  }

  return (
    <RecordsSection path={kind} label={spec.label} help={help} helpId={`${id}-execution-help`}
      statusId={`${id}-execution-status`} status={status} fields={spec.fields} recordClass="execution-record"
      form={
        <form id={`create-${id}`} className="ws-form" hidden={!allowed} onSubmit={create}>
          <h3>{spec.create}</h3>
          {spec.form}
          <div className="form-actions"><button className="button button-primary" disabled={busy}>{spec.create}</button></div>
        </form>
      }
      actions={row => {
        if (kind === 'work-logs' || !canAct || row.status !== ACTION[kind].open) return null;
        const action = ACTION[kind];
        return (
          <form className="execution-action ws-subform" onSubmit={event => act(row, event)}>
            {action.note && <TextArea label={action.note} name="actionNote" maxLength={500} rows={2} />}
            <div className="form-actions"><button className="button button-secondary" disabled={busy}>{action.button}</button></div>
          </form>
        );
      }}
    />
  );
}

export function Execution() {
  return <>{(['work-logs', 'notes', 'documents', 'issues', 'risks'] as const).map(kind => <ExecutionSection key={kind} kind={kind} />)}</>;
}
