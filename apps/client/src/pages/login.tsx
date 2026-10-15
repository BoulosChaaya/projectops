import { useState, type FormEvent } from 'react';
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
      </main>
    </div>
  );
}
