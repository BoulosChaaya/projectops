import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { Field, FormStatus, type Notice } from '../components/form.tsx';
import { Mark } from '../components/mark.tsx';
import '../styles/login.css';

// The stages a project moves through in ProjectOps, in order: what the product is, at a glance.
const STAGES = [
  ['Intake', 'Client, brief, budget and deadline'],
  ['Estimate', 'Priced in the client’s currency'],
  ['Approval', 'Recorded with who approved and when'],
  ['Delivery', 'Milestones, tasks and accepted deliverables'],
  ['Invoice', 'Issued and tracked per currency'],
  ['Paid', 'Every step kept in the project history'],
] as const;

export function LoginPage() {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  // The demo offer appears only when this deployment has it on; it costs a visitor nothing to try.
  const [demo, setDemo] = useState<{ lifetimeMinutes: number } | null>(null);
  const [demoNotice, setDemoNotice] = useState<Notice>(null);
  useEffect(() => {
    let current = true;
    api.demo().then(value => { if (current && value.enabled) setDemo({ lifetimeMinutes: value.lifetimeMinutes ?? 120 }); }).catch(() => {});
    return () => { current = false; };
  }, []);
  async function explore() {
    setBusy(true); setDemoNotice({ tone: 'success', text: 'Preparing your sandbox…' });
    try {
      await api.startDemo();
      window.location.assign('/projectops');
    } catch (error) {
      setDemoNotice({ tone: 'error', text: (error as Error).message });
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setNotice(null);
    try {
      await api.login(String(form.get('login')), String(form.get('password')));
      window.location.assign('/projectops');
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message });
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <aside className="login-story">
        <p className="login-brand"><Mark size={28} /><span>ProjectOps</span></p>
        <p className="login-lede">Client projects from intake to payment.</p>
        <ol className="lifecycle">
          {STAGES.map(([stage, detail]) => (
            <li key={stage}><span className="lifecycle-stage">{stage}</span><span className="lifecycle-detail">{detail}</span></li>
          ))}
        </ol>
      </aside>
      <main className="login-main">
        <form id="login" className="login-form" onSubmit={submit}>
          <h1>Sign in</h1>
          <Field label="Login"><input name="login" autoComplete="username" required maxLength={120} autoFocus /></Field>
          <Field label="Password"><input name="password" type="password" autoComplete="current-password" required maxLength={512} /></Field>
          <button className="button button-primary" disabled={busy}>Sign in</button>
          <FormStatus notice={notice} />
        </form>
        {demo && (
          <section id="demo" className="login-demo" aria-labelledby="demo-title">
            <h2 id="demo-title">Just looking?</h2>
            <p>Explore a sample studio with clients, projects in every stage, invoices and history. You get a private copy: change anything you like. It is deleted after {demo.lifetimeMinutes >= 120 && demo.lifetimeMinutes % 60 === 0 ? `${demo.lifetimeMinutes / 60} hours` : `${demo.lifetimeMinutes} minutes`}.</p>
            <button type="button" className="button button-secondary" onClick={explore} disabled={busy}>Explore the demo</button>
            <FormStatus notice={demoNotice} />
          </section>
        )}
      </main>
    </div>
  );
}
