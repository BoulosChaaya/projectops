import type { FormEvent } from 'react';
import { useSectionAction, useWorkspace } from './context.tsx';
import { RecordsSection } from './records-section.tsx';
import { fromUtcInput, optional, utcInput } from './format.ts';
import { Input, LEVELS, Select, TextArea } from './inputs.tsx';
import type { Row } from './record-card.tsx';

type Kind = 'milestones' | 'tasks';
type Command = 'create' | 'edit' | 'complete' | 'reopen';
const NOUN = { milestones: 'milestone', tasks: 'task' } as const;
const FIELDS = {
  milestones: ['title', 'status', 'dueAtIso', 'completedAtIso'],
  tasks: ['title', 'description', 'assignee', 'priority', 'status', 'dueAtIso', 'completedBy', 'completedAtIso'],
} as const;

/** Which planning commands the project's state allows; the server enforces the same rules. */
function allowed(kind: Kind, command: Command, status: string): boolean {
  if (kind === 'milestones') return (command === 'complete' ? ['approved', 'in_progress', 'on_hold', 'delivered'] : ['approved', 'in_progress']).includes(status);
  return ['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'].includes(status);
}

function PlanningSection({ kind }: { kind: Kind }) {
  const { project, session, write } = useWorkspace();
  const { status, busy, run } = useSectionAction(kind);
  const noun = NOUN[kind], Noun = noun === 'task' ? 'Task' : 'Milestone';
  const canCreate = allowed(kind, 'create', project.status);

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    const body = { id: crypto.randomUUID(), title: data.get('title'), dueAtIso: fromUtcInput(data.get('dueAtIso')),
      ...(kind === 'tasks' ? { description: optional(data.get('description')), assignee: optional(data.get('assignee')), priority: data.get('priority') } : {}) };
    void run(async () => { await write('POST', kind, body); form.reset(); }, `${Noun} created.`);
  }
  function save(row: Row, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = { title: data.get('title'), dueAtIso: fromUtcInput(data.get('dueAtIso')), expectedRevision: row.revision,
      ...(kind === 'tasks' ? { description: optional(data.get('description')), assignee: optional(data.get('assignee')), priority: data.get('priority') } : {}) };
    void run(() => write('PUT', `${kind}/${encodeURIComponent(row.id)}`, body), `${Noun} saved.`);
  }
  function act(row: Row, action: 'complete' | 'reopen') {
    const body = { expectedRevision: row.revision, ...(kind === 'tasks' && action === 'complete' ? { completedBy: session.login } : {}) };
    void run(() => write('POST', `${kind}/${encodeURIComponent(row.id)}/${action}`, body), action === 'complete' ? 'Completed.' : 'Reopened.');
  }

  const help = canCreate ? (kind === 'milestones' ? 'Create milestones or update open milestones.' : 'Create and manage project tasks.')
    : kind === 'milestones' && allowed(kind, 'complete', project.status) ? 'Milestones can only be completed in this project state.'
    : `${Noun} planning is read-only in this project state.`;

  return (
    <RecordsSection path={kind} label={kind === 'milestones' ? 'Milestones' : 'Tasks'} help={help} helpId={`${noun}-planning-help`}
      statusId={`${noun}-planning-status`} status={status} fields={FIELDS[kind]} recordClass="planning-record"
      form={
        <form id={`create-${noun}`} className="ws-form" hidden={!canCreate} onSubmit={create}>
          <h3>Create {noun}</h3>
          <Input label={`${Noun} title`} name="title" required maxLength={160} />
          {kind === 'tasks' && <>
            <Input label="Task assignee" name="assignee" maxLength={120} />
            <Select label="Task priority" name="priority" choices={LEVELS} defaultValue="medium" />
          </>}
          <Input label={`${Noun} due (UTC)`} name="dueAtIso" type="datetime-local" step={1} />
          {kind === 'tasks' && <TextArea label="Task description" name="description" maxLength={1000} />}
          <div className="form-actions"><button className="button button-primary" disabled={busy}>Create {noun}</button></div>
        </form>
      }
      actions={row => {
        const action = row.status === 'open' ? 'complete' : 'reopen';
        return <>
          {row.status === 'open' && allowed(kind, 'edit', project.status) && (
            // Closed until asked for, so a long list stays readable; a saved record reopens closed.
            <details className="ws-record-edit" key={`edit-${row.revision}`}>
              <summary>Edit {noun}</summary>
              <form className="planning-edit ws-subform" onSubmit={event => save(row, event)}>
                <Input label={`Edit ${noun} title`} name="title" required maxLength={160} defaultValue={String(row.title ?? '')} />
                {kind === 'tasks' && <>
                  <Input label="Edit task assignee" name="assignee" maxLength={120} defaultValue={String(row.assignee ?? '')} />
                  <Select label="Edit task priority" name="priority" choices={LEVELS} defaultValue={String(row.priority ?? 'medium')} />
                </>}
                <Input label={`Edit ${noun} due (UTC)`} name="dueAtIso" type="datetime-local" step={1} defaultValue={utcInput(row.dueAtIso as string | undefined)} />
                {kind === 'tasks' && <TextArea label="Edit task description" name="description" maxLength={1000} defaultValue={String(row.description ?? '')} />}
                <div className="form-actions"><button className="button button-secondary" disabled={busy}>Save {noun}</button></div>
              </form>
            </details>
          )}
          {allowed(kind, action, project.status) && (
            <div className="planning-actions ws-actions">
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => act(row, action)}>
                {action === 'complete' ? `Complete ${noun}` : `Reopen ${noun}`}
              </button>
            </div>
          )}
        </>;
      }}
    />
  );
}

export function Planning() {
  return <><PlanningSection kind="milestones" /><PlanningSection kind="tasks" /></>;
}
