import { useState, type ReactNode } from 'react';
import { api, type Session } from '../api.ts';
import { Mark } from './mark.tsx';
import '../styles/shell.css';

// Ordinary links: each page is its own load, whether the client or the server renders it.
const NAV = [
  { href: '/projectops', label: 'Dashboard' },
  { href: '/projectops/client-management', label: 'Clients' },
  { href: '/projectops/settings', label: 'Settings' },
] as const;

export function AppShell({ session, title, back, children }: {
  session: Session | null; title: string; back?: { href: string; label: string }; children: ReactNode;
}) {
  const here = window.location.pathname;
  // A section stays current on its sub-pages (a client's page is under Clients).
  const current = (href: string) => href === '/projectops' ? here === href : here === href || here.startsWith(`${href}/`);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  async function signOut() {
    if (!session) return;
    setSigningOut(true); setError('');
    try { await api.logout(session.csrfToken); window.location.assign('/projectops/login'); }
    catch (failure) { setError((failure as Error).message); setSigningOut(false); }
  }
  return (
    <div className="shell">
      <header className="shell-rail">
        <a className="shell-brand" href="/projectops"><Mark /><span>ProjectOps</span></a>
        <nav className="shell-nav" aria-label="Main">
          {NAV.map(item => (
            <a key={item.href} href={item.href} aria-current={current(item.href) ? 'page' : undefined}>{item.label}</a>
          ))}
        </nav>
        <div className="shell-operator">
          <span className="shell-login" title="Signed in operator">{session?.login ?? ''}</span>
          <button type="button" className="button button-quiet" onClick={signOut} disabled={!session || signingOut}>Sign out</button>
          {error && <p className="shell-error" role="alert">{error}</p>}
        </div>
      </header>
      <main className="shell-main">
        {back && <a className="page-back" href={back.href}>{back.label}</a>}
        <h1 className="page-title">{title}</h1>
        {children}
      </main>
    </div>
  );
}
