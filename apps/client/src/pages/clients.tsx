import { useEffect, useState, type FormEvent } from 'react';
import { TableScroll } from '../components/table-scroll.tsx';
import { api, type ClientListStatus, type ProjectOpsClient } from '../api.ts';
import { AppShell } from '../components/app-shell.tsx';
import { ClientFields, clientInput } from '../components/client-fields.tsx';
import { useSession } from '../use-session.ts';
import { plural } from '../format.ts';
import '../styles/clients.css';

const STATUSES: readonly [ClientListStatus, string][] = [['active', 'Active'], ['archived', 'Archived'], ['all', 'All clients']];

/** The search lives in the address (?q=&status=), like the dashboard: reload and back/forward keep it. */
function searchFromAddress(): { q: string; status: ClientListStatus } {
  const query = new URLSearchParams(window.location.search);
  const status = query.get('status');
  return { q: query.get('q') ?? '', status: status === 'archived' || status === 'all' ? status : 'active' };
}

type List = { readonly clients: readonly ProjectOpsClient[]; readonly nextCursor: string | null };

export function ClientsPage() {
  const [loaded] = useSession();
  const session = loaded.state === 'ready' ? loaded.session : null;
  const [search] = useState(searchFromAddress);
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let current = true;
    api.clients(search).then(page => { if (current) setList({ clients: page.items, nextCursor: page.nextCursor }); })
      .catch((failure: Error) => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [search]);

  async function loadMore() {
    if (!list?.nextCursor) return;
    setLoadingMore(true); setError('');
    try {
      const page = await api.clients({ ...search, cursor: list.nextCursor });
      setList({ clients: [...list.clients, ...page.items], nextCursor: page.nextCursor });
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoadingMore(false); }
  }

  const count = list === null ? (error ? 'Could not load clients.' : 'Loading clients…')
    : list.nextCursor ? `Showing first ${list.clients.length} clients` : plural(list.clients.length, 'client', 'clients');

  return (
    <AppShell session={session} title="Clients">
      <div className="clients-layout">
        <section className="clients-directory" aria-labelledby="directory-title">
          <h2 id="directory-title" className="visually-hidden">Client directory</h2>
          <form id="search" className="filter-bar" method="get" action="/projectops/client-management" role="search">
            <div className="filter-field filter-search">
              <label htmlFor="client-q">Search</label>
              <input id="client-q" name="q" type="search" defaultValue={search.q} maxLength={120} placeholder="Name, contact or email" />
            </div>
            <div className="filter-field">
              <label htmlFor="client-status">Status</label>
              <select id="client-status" name="status" defaultValue={search.status}>
                {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <button className="button button-primary">Search</button>
          </form>
          <p id="count" className="result-scope" role="status">{count}</p>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          {list && list.clients.length === 0
            ? <p className="empty-state">No clients found. Create a client or change the search.</p>
            : (
              <TableScroll label="Clients">
                <table className="clients-table">
                  <caption className="visually-hidden">Clients</caption>
                  <thead><tr><th scope="col">Name</th><th scope="col">Contact</th><th scope="col">Email</th><th scope="col">Status</th></tr></thead>
                  <tbody id="clients">
                    {list?.clients.map(client => (
                      <tr key={client.id}>
                        <td><a href={`/projectops/client-management/${encodeURIComponent(client.id)}`}>{client.name}</a></td>
                        <td>{client.contactName ?? <span className="cell-muted">None</span>}</td>
                        <td>{client.email ?? <span className="cell-muted">None</span>}</td>
                        <td><span className="status-chip" data-status={client.status}>{client.status === 'archived' ? 'Archived' : 'Active'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          {list?.nextCursor && (
            <button type="button" className="button button-quiet list-more-button" onClick={loadMore} disabled={loadingMore}>Load more clients</button>
          )}
        </section>
        <aside className="clients-create" aria-labelledby="create-title">
          <NewClient csrf={session?.csrfToken ?? null} />
        </aside>
      </div>
    </AppShell>
  );
}

function NewClient({ csrf }: { csrf: string | null }) {
  // One id per form: a retried submit cannot create a second client.
  const [id] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const client = await api.createClient(csrf!, id, clientInput(event.currentTarget));
      window.location.assign(`/projectops/client-management/${encodeURIComponent(client.id)}`);
    } catch (failure) { setError((failure as Error).message); setBusy(false); }
  }
  return (
    <form id="create" className="sheet form-grid" onSubmit={submit}>
      <h2 id="create-title">New client</h2>
      <ClientFields />
      <div className="form-actions">
        <button className="button button-primary" disabled={!csrf || busy}>Create client</button>
      </div>
      {error && <p className="form-status form-status-error" role="alert">{error}</p>}
    </form>
  );
}
