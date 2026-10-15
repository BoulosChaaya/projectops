import { useState, type FormEvent } from 'react';
import type { ProjectRequest } from '../../api.ts';
import { ProjectFields, projectInput } from '../../components/project-fields.tsx';
import { useWorkspace } from './context.tsx';
import { money, workspaceDate } from './format.ts';

export const READ_ONLY = ['archived', 'cancelled'];

/** The project's facts, and the edit form while the project is still open. */
export function Overview() {
  const { project, session, setProject, report, failed, write } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const tz = session.defaults.timezone;
  const readOnly = READ_ONLY.includes(project.status);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); report('');
    try {
      setProject(await write<ProjectRequest>('PUT', '', { ...projectInput(event.currentTarget), expectedRevision: project.revision }));
      report('Project saved.');
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  }
  return (
    <section id="overview" className="ws-section" aria-labelledby="overview-title">
      <h2 id="overview-title">Overview</h2>
      <p id="brief" className="ws-brief">{project.brief}</p>
      <dl className="ws-facts">
        <div><dt>Budget range</dt><dd id="budget">{project.budgetRange || 'No budget range'}</dd></div>
        <div><dt>Priority</dt><dd id="priority">{project.priority}</dd></div>
        <div><dt>Deadline</dt><dd id="deadline">{project.deadlineIso ? workspaceDate(project.deadlineIso, tz) : 'No deadline'}</dd></div>
        <div><dt>Estimate</dt><dd id="estimate">{project.estimateAmountCents == null ? 'No estimate' : money(project.estimateAmountCents, project.estimateCurrency)}</dd></div>
        <div><dt>Approval</dt><dd id="approval">{project.approvedAtIso ? `${project.approvedBy} · ${workspaceDate(project.approvedAtIso, tz)}` : 'No approval'}</dd></div>
      </dl>
      <p id="archived" className="ws-readonly" hidden={!readOnly}>{project.status === 'cancelled' ? 'Cancelled projects are read-only.' : 'Archived projects are read-only.'}</p>
      <details className="ws-edit" hidden={readOnly} open>
        <summary>Edit project details</summary>
        <form id="edit-project" className="ws-form" onSubmit={save} hidden={readOnly} key={project.revision}>
          <ProjectFields defaultPriority={session.defaults.defaultPriority} project={project} />
          <div className="form-actions"><button className="button button-primary" disabled={busy || readOnly}>Save project</button></div>
        </form>
      </details>
    </section>
  );
}
