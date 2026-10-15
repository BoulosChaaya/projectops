import { useState, type FormEvent } from 'react';
import { api, type OperatorDefaults, type Priority } from '../api.ts';
import { AppShell } from '../components/app-shell.tsx';
import { Field, FormStatus, type Notice } from '../components/form.tsx';
import { useSession } from '../use-session.ts';
import '../styles/settings.css';

export function SettingsPage() {
  const [loaded, setSession] = useSession();
  const session = loaded.state === 'ready' ? loaded.session : null;
  return (
    <AppShell session={session} title="Settings">
      {loaded.state === 'failed' && <p className="page-error" role="alert">{loaded.message}</p>}
      <section className="settings-section" aria-labelledby="defaults-title">
        <div className="settings-intro">
          <h2 id="defaults-title">Project defaults</h2>
          <p>Used when a new project or estimate leaves these out. Dates are shown in this timezone.</p>
        </div>
        <DefaultsForm key={session ? 'ready' : 'loading'} defaults={session?.defaults ?? null}
          onSave={async defaults => { const saved = await api.saveDefaults(session!.csrfToken, defaults); setSession({ ...session!, defaults: saved }); }} />
      </section>
      <section className="settings-section" aria-labelledby="credentials-title">
        <div className="settings-intro">
          <h2 id="credentials-title">Sign-in credentials</h2>
          <p>Changing them signs out every session, including this one.</p>
        </div>
        <CredentialsForm key={session ? 'ready' : 'loading'} login={session?.login ?? ''} csrf={session?.csrfToken ?? null} />
      </section>
    </AppShell>
  );
}

function DefaultsForm({ defaults, onSave }: { defaults: OperatorDefaults | null; onSave: (value: OperatorDefaults) => Promise<void> }) {
  const [value, setValue] = useState<OperatorDefaults>(defaults ?? { defaultCurrency: '', defaultPriority: 'medium', timezone: '' });
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setNotice(null);
    try { await onSave(value); setNotice({ tone: 'success', text: 'Defaults saved.' }); }
    catch (error) { setNotice({ tone: 'error', text: (error as Error).message }); }
    finally { setBusy(false); }
  }
  return (
    <form id="defaults" className="sheet form-grid" onSubmit={submit}>
      <Field label="Currency" hint="Three-letter code, such as EUR">
        <input name="defaultCurrency" value={value.defaultCurrency} required pattern="[A-Z]{3}" maxLength={3} className="input-short"
          onChange={event => setValue({ ...value, defaultCurrency: event.target.value.toUpperCase() })} />
      </Field>
      <Field label="Priority">
        <select name="defaultPriority" value={value.defaultPriority}
          onChange={event => setValue({ ...value, defaultPriority: event.target.value as Priority })}>
          <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
        </select>
      </Field>
      <Field label="Timezone" hint="IANA name, such as Asia/Beirut">
        <input name="timezone" value={value.timezone} required maxLength={100}
          onChange={event => setValue({ ...value, timezone: event.target.value })} />
      </Field>
      <div className="form-actions">
        <button className="button button-primary" disabled={!defaults || busy}>Save defaults</button>
        <FormStatus notice={notice} />
      </div>
    </form>
  );
}

function CredentialsForm({ login, csrf }: { login: string; csrf: string | null }) {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setNotice(null);
    try {
      await api.changeCredentials(csrf!, { newLogin: String(form.get('newLogin')), currentPassword: String(form.get('currentPassword')), newPassword: String(form.get('newPassword')) });
      window.location.assign('/projectops/login');
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message });
      setBusy(false);
    }
  }
  return (
    <form id="credentials" className="sheet form-grid" onSubmit={submit}>
      <Field label="Login"><input name="newLogin" defaultValue={login} autoComplete="username" required maxLength={120} /></Field>
      <Field label="Current password"><input name="currentPassword" type="password" autoComplete="current-password" required maxLength={512} /></Field>
      <Field label="New password" hint="At least 12 characters">
        <input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={512} />
      </Field>
      <div className="form-actions">
        <button className="button button-primary" disabled={!csrf || busy}>Change credentials</button>
        <FormStatus notice={notice} />
      </div>
    </form>
  );
}
