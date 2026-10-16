import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { TableScroll } from '../components/table-scroll.tsx';
import { api, ApiError, type ProjectOpsClient, type ProjectRequest, type Session } from '../api.ts';
import { AppShell } from '../components/app-shell.tsx';
import { ClientFields, clientInput } from '../components/client-fields.tsx';
import { ProjectFields, projectInput } from '../components/project-fields.tsx';
import { useSession } from '../use-session.ts';
import { statusLabel } from '../format.ts';
import '../styles/clients.css';

type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly client: ProjectOpsClient; readonly projects: readonly ProjectRequest[] }
  | { readonly state: 'failed'; readonly notFound: boolean };

export function ClientPage({ params }: { params: readonly string[] }) {
  const id = params[0]!;
  const [loaded] = useSession();
  const session = loaded.state === 'ready' ? loaded.session : null;
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  // One page-level status line for every action on this page, announced to screen readers.
  const [message, setMessage] = useState('');
  const [stale, setStale] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [client, projects] = await Promise.all([api.client(id), api.clientProjects(id)]);
      setLoad({ state: 'ready', client, projects });
      setStale(false);
      document.title = `${client.name} – ProjectOps`;
    } catch (error) {
      setLoad({ state: 'failed', notFound: error instanceof ApiError && error.status === 404 });
      setMessage((error as Error).message);
    }
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);

  /** A 409 means someone else changed the client since this page loaded: offer a reload, never overwrite. */
  function failed(error: unknown) {
    setMessage((error as Error).message);
    if (error instanceof ApiError && error.status === 409) setStale(true);
  }

  const client = load.state === 'ready' ? load.client : null;
  const archived = client?.status === 'archived';
  const statusLine = load.state === 'loading' ? 'Loading client…'
    : load.state === 'failed' ? (load.notFound ? 'Client not found.' : 'Could not load client.')
    : archived ? 'Archived client' : 'Active client';

  return (
    <AppShell session={session} title={client?.name ?? 'Client'} back={{ href: '/projectops/client-management', label: 'Back to clients' }}>
      <p id="client-status" className={`client-status${archived ? ' client-status-archived' : ''}`}>{statusLine}</p>
      <p id="message" className="page-message" role="status" aria-live="polite">{message}</p>
      {(stale || load.state === 'failed') && (
        <p><button type="button" className="button button-quiet" onClick={() => { setMessage(''); void reload(); }}>Reload client</button></p>
      )}
      {load.state === 'ready' && client && (
        <div className="client-layout">
          <div className="client-main">
            <section aria-labelledby="projects-title">
              <h2 id="projects-title">Projects</h2>
              {load.projects.length === 0 ? <p className="empty-state">No projects for this client.</p> : (
                <TableScroll label="Projects for this client">
                  <table className="client-projects">
                    <caption className="visually-hidden">Projects for this client</caption>
                    <thead><tr><th scope="col">Project</th><th scope="col">Status</th><th scope="col">Priority</th></tr></thead>
                    <tbody id="projects">
                      {load.projects.map(project => (
                        <tr key={project.id}>
                          <td><a href={`/projectops/projects/${encodeURIComponent(project.id)}`}>{project.title}</a></td>
                          <td><span className="status-chip" data-status={project.status}>{statusLabel(project.status)}</span></td>
                          <td>{project.priority}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </section>
            {archived ? null : <NewProject client={client} session={session} onError={failed} />}
          </div>
          <aside className="client-side" aria-labelledby="contact-title">
            <ContactDetails key={client.revision} client={client} session={session} onSaved={(saved, note) => {
              setLoad({ ...load, client: saved }); setMessage(note);
            }} onError={failed} />
          </aside>
        </div>
      )}
    </AppShell>
  );
}

function ContactDetails({ client, session, onSaved, onError }: {
  client: ProjectOpsClient; session: Session | null;
  onSaved: (client: ProjectOpsClient, message: string) => void; onError: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const archived = client.status === 'archived';
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try { onSaved(await api.editClient(session!.csrfToken, client.id, clientInput(event.currentTarget), client.revision ?? 1), 'Client saved.'); }
    catch (error) { onError(error); setBusy(false); }
  }
  async function archive() {
    setBusy(true);
    try { onSaved(await api.archiveClient(session!.csrfToken, client.id, client.revision ?? 1), 'Client archived.'); }
    catch (error) { onError(error); setBusy(false); setConfirming(false); }
  }
  return (
    <div className="sheet contact">
      <h2 id="contact-title">Contact details</h2>
      <dl className="contact-list">
        <div><dt>Contact</dt><dd>{client.contactName ?? 'None'}</dd></div>
        <div><dt>Email</dt><dd>{client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : 'None'}</dd></div>
      </dl>
      {archived ? (
        <p className="contact-archived">This client is archived. Contact details and existing projects remain viewable.</p>
      ) : (
        <>
          <form id="edit" className="form-grid" onSubmit={save}>
            <ClientFields client={client} />
            <div className="form-actions">
              <button className="button button-primary" disabled={!session || busy}>Save changes</button>
            </div>
          </form>
          <div className="archive-zone">
            {confirming ? (
              <div className="confirm" role="group" aria-label="Confirm archive">
                <p>Archive this client? Existing projects stay available; new projects will be blocked.</p>
                <div className="form-actions">
                  <button type="button" className="button button-danger" onClick={archive} disabled={busy} autoFocus>Confirm archive</button>
                  <button type="button" className="button button-quiet" onClick={() => setConfirming(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" className="button button-quiet" onClick={() => setConfirming(true)} disabled={!session || busy}>Archive client</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NewProject({ client, session, onError }: { client: ProjectOpsClient; session: Session | null; onError: (error: unknown) => void }) {
  const [id] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const project = await api.createProject(session!.csrfToken, id, client.id, projectInput(event.currentTarget));
      window.location.assign(`/projectops/projects/${encodeURIComponent(project.id)}`);
    } catch (error) { onError(error); setBusy(false); }
  }
  return (
    <section className="new-project" aria-labelledby="new-project-title">
      <h2 id="new-project-title">New project</h2>
      <form id="create-project" className="sheet form-grid" onSubmit={submit}>
        {/* Keyed on the session so the priority picks up the operator's saved default once it loads. */}
        <ProjectFields key={session ? 'ready' : 'loading'} defaultPriority={session?.defaults.defaultPriority ?? 'medium'} />
        <div className="form-actions">
          <button className="button button-primary" disabled={!session || busy}>Create project</button>
        </div>
      </form>
    </section>
  );
}
