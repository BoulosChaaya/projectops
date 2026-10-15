import type { JSX } from 'react';
import { DashboardPage } from './pages/dashboard.tsx';
import { ClientsPage } from './pages/clients.tsx';
import { ClientPage } from './pages/client.tsx';
import { ProjectPage } from './pages/project/project.tsx';
import { LoginPage } from './pages/login.tsx';
import { SettingsPage } from './pages/settings.tsx';
import { NotFoundPage } from './pages/not-found.tsx';

type Route = { readonly path: RegExp; readonly title: string; readonly Page: (props: { params: readonly string[] }) => JSX.Element };

// Pages move to the client one area at a time. The API server serves this app for each migrated
// path; every other path is still a server-rendered page, reached by an ordinary link.
const routes: readonly Route[] = [
  { path: /^\/projectops$/, title: 'Dashboard', Page: DashboardPage },
  { path: /^\/projectops\/client-management$/, title: 'Clients', Page: ClientsPage },
  { path: /^\/projectops\/client-management\/([^/]+)$/, title: 'Client', Page: ClientPage },
  { path: /^\/projectops\/projects\/([^/]+)$/, title: 'Project', Page: ProjectPage },
  { path: /^\/projectops\/login$/, title: 'Sign in', Page: LoginPage },
  { path: /^\/projectops\/settings$/, title: 'Settings', Page: SettingsPage },
];

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '');
  for (const route of routes) {
    const match = route.path.exec(path);
    if (!match) continue;
    document.title = `${route.title} – ProjectOps`;
    const params = match.slice(1).map(value => { try { return decodeURIComponent(value); } catch { return value; } });
    return <route.Page params={params} />;
  }
  document.title = 'Page not found – ProjectOps';
  return <NotFoundPage />;
}
