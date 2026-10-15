import type { Priority, ProjectInput, ProjectRequest } from '../api.ts';
import { Field } from './form.tsx';

/** Title, brief, budget, priority and deadline: empty for a new project, filled to edit one. */
export function ProjectFields({ defaultPriority, project }: { defaultPriority: Priority; project?: ProjectRequest }) {
  return (
    <>
      <Field label="Project title"><input name="title" required maxLength={160} defaultValue={project?.title ?? ''} /></Field>
      <Field label="Brief"><textarea name="brief" required maxLength={4000} rows={5} defaultValue={project?.brief ?? ''} /></Field>
      <Field label="Budget range" hint="Free text, such as EUR 4–5k"><input name="budgetRange" maxLength={120} defaultValue={project?.budgetRange ?? ''} /></Field>
      <Field label="Priority">
        <select name="priority" defaultValue={project?.priority ?? defaultPriority}>
          <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
        </select>
      </Field>
      {/* Entered and stored as UTC, as on the project page, until dates move to the operator's timezone everywhere. */}
      <Field label="Deadline (UTC)"><input name="deadlineIso" type="datetime-local" step={1} defaultValue={project?.deadlineIso ? new Date(project.deadlineIso).toISOString().slice(0, 19) : ''} /></Field>
    </>
  );
}

export function projectInput(form: HTMLFormElement): ProjectInput {
  const data = new FormData(form);
  const text = (name: string) => String(data.get(name) ?? '');
  const deadline = text('deadlineIso');
  return {
    title: text('title'),
    brief: text('brief'),
    budgetRange: text('budgetRange').trim() || undefined,
    priority: text('priority') as Priority,
    deadlineIso: deadline ? new Date(`${deadline}Z`).toISOString() : undefined,
  };
}
