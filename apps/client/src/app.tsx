import type { JSX } from 'react';
import { LoginPage } from './pages/login.tsx';
import { SettingsPage } from './pages/settings.tsx';
import { NotFoundPage } from './pages/not-found.tsx';

// Pages move to the client one area at a time. The API server serves this app for each migrated
// path; every other path is still a server-rendered page, reached by an ordinary link.
const pages: Record<string, { readonly title: string; readonly Page: () => JSX.Element }> = {
  '/projectops/login': { title: 'Sign in', Page: LoginPage },
  '/projectops/settings': { title: 'Settings', Page: SettingsPage },
};

export function App() {
  const { title, Page } = pages[window.location.pathname.replace(/\/+$/, '')] ?? { title: 'Page not found', Page: NotFoundPage };
  document.title = `${title} – ProjectOps`;
  return <Page />;
}
