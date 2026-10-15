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

export function AppShell({ session, title, back, wide, children }: {
  session: Session | null; title: string; back?: { href: string; label: string };
  /** Wider work area, for pages with a side column (the project workspace). */
  wide?: boolean; children: ReactNode;
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
      <main className={`shell-main${wide ? ' shell-main-wide' : ''}`}>
        {session?.demo && <DemoBanner csrf={session.csrfToken} expiresAtIso={session.demo.expiresAtIso} onLeave={signOut} leaving={signingOut} />}
        {back && <a className="page-back" href={back.href}>{back.label}</a>}
        <h1 className="page-title">{title}</h1>
        {children}
      </main>
    </div>
  );
}

/**
 * Shown on every page of a demo sandbox: whose data this is, when it goes, and the two ways out
 * of it (a fresh copy, or leaving, which deletes it now).
 */
function DemoBanner({ csrf, expiresAtIso, onLeave, leaving }: {
  csrf: string; expiresAtIso: string; onLeave: () => void; leaving: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The visitor's own clock, not the sandbox's settings: "when does my copy go" is about them.
  const time = new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(new Date(expiresAtIso));
  const minutes = Math.max(0, Math.round((Date.parse(expiresAtIso) - Date.now()) / 60_000));
  const left = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
  async function reset() {
    setBusy(true); setError('');
    try { await api.resetDemo(csrf); window.location.reload(); }
    catch (failure) { setError((failure as Error).message); setBusy(false); }
  }
  return (
    <section id="demo-banner" className="demo-banner" aria-label="Demo sandbox">
      <p><strong>Demo sandbox.</strong> This sample studio is your private copy: change anything. It is deleted at {time} (in {left}).</p>
      <div className="demo-banner-actions">
        <button type="button" className="button button-quiet" onClick={reset} disabled={busy || leaving}>Reset sample data</button>
        <button type="button" className="button button-quiet" onClick={onLeave} disabled={busy || leaving}>Leave demo</button>
      </div>
      {error && <p className="demo-banner-error" role="alert">{error}</p>}
    </section>
  );
}
