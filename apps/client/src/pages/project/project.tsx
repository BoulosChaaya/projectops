import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type ProjectOpsClient, type ProjectRequest } from '../../api.ts';
import { AppShell } from '../../components/app-shell.tsx';
import { useSession } from '../../use-session.ts';
import { statusLabel } from '../../format.ts';
import { WorkspaceProvider } from './context.tsx';
import { projectSections } from './sections.ts';
import { Overview } from './overview.tsx';
import { Controls } from './controls.tsx';
import { Planning } from './planning.tsx';
import { Execution } from './execution.tsx';
import { Delivery } from './delivery.tsx';
import { Finances } from './finances.tsx';
import { RecordsSection } from './records-section.tsx';
import { History } from './history.tsx';
import { Handoff } from './handoff.tsx';
import '../../styles/forms.css';
import '../../styles/workspace.css';

type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly project: ProjectRequest; readonly client: ProjectOpsClient }
  | { readonly state: 'failed'; readonly notFound: boolean };

const JUMPS = [
  { path: 'overview', label: 'Overview' },
  { path: 'controls', label: 'Estimates and controls' },
  { path: 'handoff', label: 'Export and handoff' },
  ...projectSections,
] as const;

/**
 * The project workspace: one page per project, with every section a project has. Each section
 * loads its own records and reports its own failures, so one failed list never blanks the page.
 */
export function ProjectPage({ params }: { params: readonly string[] }) {
  const id = params[0]!;
  const [loaded] = useSession();
  const session = loaded.state === 'ready' ? loaded.session : null;
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [message, setMessage] = useState('');
  const [stale, setStale] = useState(false);
  // Reloading the project starts every section afresh, as opening the page does.
  const [generation, setGeneration] = useState(0);

  const reload = useCallback(async () => {
    try {
      const project = await api.project(id);
      const client = await api.client(project.clientId);
      setLoad({ state: 'ready', project, client });
      setStale(false);
      setGeneration(value => value + 1);
      document.title = `${project.title} – ProjectOps`;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { window.location.assign('/projectops/login'); return; }
      setLoad({ state: 'failed', notFound: error instanceof ApiError && error.status === 404 });
      setMessage((error as Error).message);
    }
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);

  const project = load.state === 'ready' ? load.project : null;
  const statusLine = load.state === 'loading' ? 'Loading project…'
    : load.state === 'failed' ? (load.notFound ? 'Project not found.' : 'Could not load project.')
    : statusLabel(load.project.status);

  return (
    <AppShell session={session} title={project?.title ?? 'Project workspace'}
      back={load.state === 'ready' ? { href: `/projectops/client-management/${encodeURIComponent(load.client.id)}`, label: load.client.name } : undefined}>
      <div className="ws-head">
        <p id="project-status" role="status">
          {project ? <span className="status-chip" data-status={project.status}>{statusLine}</span> : statusLine}
        </p>
        <p id="message" className="page-message" role="status" aria-live="polite">{message}</p>
        <button id="reload" type="button" className="button button-quiet" hidden={!(stale || load.state === 'failed')}
          onClick={() => { setMessage(''); void reload(); }}>Reload project</button>
      </div>
      {load.state === 'ready' && session && project && (
        <div className="ws-layout">
          <nav className="ws-jump" aria-label="Project sections">
            {JUMPS.map(jump => <a key={jump.path} href={`#${jump.path}`}>{jump.label}</a>)}
          </nav>
          <div className="ws-main">
            <WorkspaceProvider key={generation} id={id} project={project} session={session}
              setProject={next => setLoad(current => current.state === 'ready' ? { ...current, project: next } : current)}
              report={setMessage} onConflict={() => setStale(true)}>
              <Overview />
              <Controls />
              <Planning />
              <Execution />
              <Delivery />
              <Finances />
              <RecordsSection path="change-requests" label="Change requests"
                fields={['title', 'description', 'requestedBy', 'estimateDeltaCents', 'estimateCurrency', 'status', 'decisionNote']} />
              <History />
              <Handoff />
            </WorkspaceProvider>
          </div>
        </div>
      )}
    </AppShell>
  );
}
