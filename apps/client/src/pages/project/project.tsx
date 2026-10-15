import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { api, ApiError, type ProjectOpsClient, type ProjectRequest } from '../../api.ts';
import { AppShell } from '../../components/app-shell.tsx';
import { useSession } from '../../use-session.ts';
import { statusLabel } from '../../format.ts';
import { useCollection, useWorkspace, WorkspaceProvider } from './context.tsx';
import { tabFromLocation, workspaceTabs, type WorkspaceTab } from './sections.ts';
import { money, workspaceDate } from './format.ts';
import { Overview } from './overview.tsx';
import { Controls } from './controls.tsx';
import { Planning } from './planning.tsx';
import { Execution } from './execution.tsx';
import { Delivery } from './delivery.tsx';
import { Finances, sumByCurrency } from './finances.tsx';
import { RecordsSection } from './records-section.tsx';
import { History } from './history.tsx';
import '../../styles/forms.css';
import '../../styles/workspace.css';

type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly project: ProjectRequest; readonly client: ProjectOpsClient }
  | { readonly state: 'failed'; readonly notFound: boolean };

/** The four numbers that say where a project stands, above every tab. */
function Figures() {
  const { project, session } = useWorkspace();
  const tasks = useCollection('tasks'), invoices = useCollection('invoices');
  const done = tasks.state === 'ready' ? tasks.rows.filter(row => row.status === 'completed').length : 0;
  return (
    <dl className="ws-figures">
      <div><dt>Estimate</dt><dd id="estimate">{project.estimateAmountCents == null ? 'No estimate' : money(project.estimateAmountCents, project.estimateCurrency)}</dd></div>
      <div><dt>Deadline</dt><dd id="deadline">{project.deadlineIso ? workspaceDate(project.deadlineIso, session.defaults.timezone) : 'No deadline'}</dd></div>
      <div><dt>Tasks done</dt><dd id="tasks-done">{tasks.state === 'ready' ? (tasks.rows.length ? `${done} of ${tasks.rows.length}` : 'No tasks') : '—'}</dd></div>
      <div><dt>Unpaid invoices</dt><dd id="unpaid">{invoices.state === 'ready' ? sumByCurrency(invoices.rows, 'issued') || 'None' : '—'}</dd></div>
    </dl>
  );
}

function TabPanel({ tab }: { tab: WorkspaceTab }) {
  switch (tab) {
    case 'overview': return <Overview />;
    case 'plan': return <Planning />;
    case 'work': return <Execution />;
    case 'delivery': return <Delivery />;
    case 'money': return <>
      <Finances />
      <RecordsSection path="change-requests" label="Change requests"
        fields={['title', 'description', 'requestedBy', 'estimateDeltaCents', 'estimateCurrency', 'status', 'decisionNote']} />
    </>;
  }
}

/**
 * The project workspace: a header with the project's figures and next actions, tabs for its
 * areas (kept in the address, so reload, back/forward and links keep the tab), and the history
 * beside every tab. Each section loads its own records and reports its own failures.
 */
export function ProjectPage({ params }: { params: readonly string[] }) {
  const id = params[0]!;
  const [loaded] = useSession();
  const session = loaded.state === 'ready' ? loaded.session : null;
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [message, setMessage] = useState('');
  const [stale, setStale] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>(() => tabFromLocation(window.location.search, window.location.hash));
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
  // A link to a section (#tasks) scrolls to it once its tab has rendered.
  const ready = load.state === 'ready';
  useEffect(() => {
    if (ready && window.location.hash) document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
  }, [ready]);
  useEffect(() => {
    const follow = () => setTab(tabFromLocation(window.location.search, window.location.hash));
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);

  function select(event: MouseEvent<HTMLAnchorElement>, next: WorkspaceTab) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (next === tab) return;
    window.history.pushState(null, '', tabHref(next));
    setTab(next);
  }

  const project = load.state === 'ready' ? load.project : null;
  const statusLine = load.state === 'loading' ? 'Loading project…'
    : load.state === 'failed' ? (load.notFound ? 'Project not found.' : 'Could not load project.')
    : statusLabel(load.project.status);

  return (
    <AppShell session={session} title={project?.title ?? 'Project workspace'} wide
      back={load.state === 'ready' ? { href: `/projectops/client-management/${encodeURIComponent(load.client.id)}`, label: load.client.name } : undefined}>
      <p id="project-status" className="ws-status-line" role="status">
        {project ? <span className="status-chip" data-status={project.status}>{statusLine}</span> : statusLine}
      </p>
      {load.state === 'ready' && session && project ? (
        <WorkspaceProvider key={generation} id={id} project={project} session={session}
          setProject={next => setLoad(current => current.state === 'ready' ? { ...current, project: next } : current)}
          report={setMessage} onConflict={() => setStale(true)}>
          <div className="ws-header">
            <Figures />
            <Controls />
          </div>
          <Notice message={message} stale={stale} onReload={() => { setMessage(''); void reload(); }} />
          <nav className="ws-tabs" aria-label="Project sections">
            {workspaceTabs.map(item => (
              <a key={item.id} href={tabHref(item.id)} aria-current={item.id === tab ? 'page' : undefined}
                onClick={event => select(event, item.id)}>{item.label}</a>
            ))}
          </nav>
          <div className="ws-layout">
            <div className="ws-main" id="workspace-panel"><TabPanel tab={tab} /></div>
            <History />
          </div>
        </WorkspaceProvider>
      ) : (
        <Notice message={message} stale={stale || load.state === 'failed'} onReload={() => { setMessage(''); void reload(); }} />
      )}
    </AppShell>
  );
}

/** The page's status line for the last page-level action, and the reload offered after a conflict. */
function Notice({ message, stale, onReload }: { message: string; stale: boolean; onReload: () => void }) {
  return (
    <div className="ws-notice">
      <p id="message" className="page-message" role="status" aria-live="polite">{message}</p>
      <button id="reload" type="button" className="button button-quiet" hidden={!stale} onClick={onReload}>Reload project</button>
    </div>
  );
}

function tabHref(tab: WorkspaceTab): string {
  const url = new URL(window.location.href);
  if (tab === 'overview') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
  url.hash = '';
  return url.pathname + url.search;
}
