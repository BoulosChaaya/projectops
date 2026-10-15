import { useState, type FormEvent } from 'react';
import type { ProjectRequest } from '../../api.ts';
import { ProjectFields, projectInput } from '../../components/project-fields.tsx';
import { useWorkspace } from './context.tsx';
import { workspaceDate } from './format.ts';
import { Readiness } from './delivery.tsx';
import { Totals } from './finances.tsx';
import { Handoff } from './handoff.tsx';

export const READ_ONLY = ['archived', 'cancelled'];

/** The brief and the project's own details, with their edit form behind a disclosure. */
function Details() {
  const { project, session, setProject, report, failed, write } = useWorkspace();
  const [busy, setBusy] = useState(false);
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
      <header className="ws-section-head"><h2 id="overview-title">Brief</h2></header>
      <p id="brief" className="ws-brief">{project.brief}</p>
      <dl className="ws-facts">
        <div><dt>Budget range</dt><dd id="budget">{project.budgetRange || 'No budget range'}</dd></div>
        <div><dt>Priority</dt><dd id="priority">{project.priority}</dd></div>
        <div><dt>Approval</dt><dd id="approval">{project.approvedAtIso ? `${project.approvedBy} · ${workspaceDate(project.approvedAtIso, session.defaults.timezone)}` : 'No approval'}</dd></div>
      </dl>
      <p id="archived" className="ws-readonly" hidden={!readOnly}>{project.status === 'cancelled' ? 'Cancelled projects are read-only.' : 'Archived projects are read-only.'}</p>
      {/* Keyed on the revision: after a save, or a change elsewhere, the form shows the stored values. */}
      <details className="ws-record-edit" hidden={readOnly} key={project.revision}>
        <summary>Edit project details</summary>
        <form id="edit-project" className="ws-form ws-subform" onSubmit={save}>
          <ProjectFields defaultPriority={session.defaults.defaultPriority} project={project} />
          <div className="form-actions"><button className="button button-primary" disabled={busy || readOnly}>Save project</button></div>
        </form>
      </details>
    </section>
  );
}

/** The project at a glance: what it is, whether it can be delivered, where the money stands, and its handoff. */
export function Overview() {
  return (
    <>
      <Details />
      <div className="ws-pair"><Readiness /><Totals /></div>
      <Handoff />
    </>
  );
}
