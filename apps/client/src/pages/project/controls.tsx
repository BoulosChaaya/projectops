import { useEffect, useState, type FormEvent } from 'react';
import type { ProjectRequest } from '../../api.ts';
import { useWorkspace } from './context.tsx';
import { money } from './format.ts';

type Action = 'approve' | 'start' | 'hold' | 'resume' | 'cancel' | 'deliver' | 'archive';

// What each state allows, in the order the buttons appear. The server enforces the same rules.
const ACTIONS: Readonly<Record<string, readonly Action[]>> = {
  new: ['cancel'], estimated: ['approve', 'cancel'], approved: ['start', 'cancel'], in_progress: ['hold', 'deliver', 'cancel'],
  on_hold: ['resume', 'cancel'], cancelled: ['archive'], delivered: ['archive'], archived: [],
};
const BUTTON: Readonly<Record<Action, string>> = {
  approve: 'Approve estimate', start: 'Start project', hold: 'Hold project', resume: 'Resume project',
  cancel: 'Cancel project', deliver: 'Mark delivered', archive: 'Archive project',
};
const CONFIRM: Readonly<Record<Action, string>> = {
  approve: 'Confirm approval', start: 'Confirm start', hold: 'Confirm hold', resume: 'Confirm resume',
  cancel: 'Confirm cancellation', deliver: 'Confirm delivery', archive: 'Confirm archive',
};
const DONE: Readonly<Record<Action, string>> = {
  approve: 'Estimate approved.', start: 'Project started.', hold: 'Project placed on hold.', resume: 'Project resumed.',
  cancel: 'Project cancelled.', deliver: 'Project marked delivered.', archive: 'Project archived.',
};

function guidance(status: string): string {
  return status === 'estimated' ? 'Review the estimate before approval. Estimates can be revised until approved.'
    : status === 'on_hold' ? 'Work is on hold. Resume before delivery.'
    : status === 'cancelled' ? 'This project is cancelled. Records are retained; only archiving is available.'
    : status === 'archived' ? 'This project is archived.'
    : 'Choose an action available for the current state.';
}

/** Estimate and lifecycle: every state change asks for confirmation and carries the revision it read. */
export function Controls() {
  const { project, session, setProject, report, failed, write } = useWorkspace();
  const [pending, setPending] = useState<{ action: Action; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const estimating = ['new', 'estimated'].includes(project.status);
  // A confirmation belongs to the revision it was asked about; any change to the project closes it.
  useEffect(() => { setPending(null); }, [project.revision, project.status]);

  async function saveEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); report('');
    try {
      const amount = String(form.get('amount') ?? '').trim();
      if (!/^[0-9]+([.][0-9]{1,2})?$/.test(amount)) throw Error('Enter an amount with at most two decimal places.');
      const [whole, fraction = ''] = amount.split('.');
      const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 1_000_000_000) throw Error('Estimate must be between 0.01 and 10000000.00.');
      setProject(await write<ProjectRequest>('POST', 'estimate', { amountCents, currency: form.get('currency'), expectedRevision: project.revision }));
      report('Estimate saved.');
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true); report('');
    try {
      const body = pending.action === 'approve'
        ? { approvedBy: session.login, expectedRevision: pending.revision }
        : { action: pending.action, expectedRevision: pending.revision };
      setProject(await write<ProjectRequest>('POST', pending.action === 'approve' ? 'approve' : 'control', body));
      report(DONE[pending.action]);
      setPending(null);
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  }

  const question = !pending ? '' : pending.action === 'approve'
    ? `Approve ${money(project.estimateAmountCents ?? 0, project.estimateCurrency)} as ${session.login}?`
    : pending.action === 'cancel' ? 'Cancel this project? Existing records will remain viewable and the project will become read-only.'
    : pending.action === 'archive' ? 'Archive this project? Records will remain viewable.'
    : `Confirm ${BUTTON[pending.action].toLowerCase()}?`;

  return (
    <section id="controls" className="ws-controls" aria-labelledby="controls-title">
      <h2 id="controls-title" className="visually-hidden">Estimates and controls</h2>
      <div className="ws-controls-row">
        <p id="control-status" className="ws-controls-guidance">{guidance(project.status)}</p>
        <div id="control-actions" className="ws-actions">
          {(ACTIONS[project.status] ?? []).map(action => (
            <button key={action} type="button" disabled={busy}
              className={`button ${action === 'cancel' ? 'button-quiet' : 'button-primary'}`}
              onClick={() => setPending({ action, revision: project.revision ?? 1 })}>{BUTTON[action]}</button>
          ))}
        </div>
      </div>
      <form id="estimate-form" className="ws-form-inline" hidden={!estimating} onSubmit={saveEstimate} key={`estimate-${project.revision}`}>
        <label className="field"><span className="field-label">Estimate amount (currency units)</span>
          <input name="amount" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" required maxLength={12}
            defaultValue={project.estimateAmountCents == null ? '' : (project.estimateAmountCents / 100).toFixed(2)} /></label>
        <label className="field"><span className="field-label">Estimate currency</span>
          <input name="currency" required pattern="[A-Z]{3}" maxLength={3} className="input-short"
            defaultValue={project.estimateCurrency ?? session.defaults.defaultCurrency} /></label>
        <button className="button button-secondary" disabled={busy}>Save estimate</button>
      </form>
      {pending && (
        <div id="control-confirmation" className="ws-confirm" role="group" aria-label="Confirm project action">
          <p id="control-question">{question}</p>
          <div className="ws-actions">
            <button id="confirm-control" type="button" className={`button ${pending.action === 'cancel' ? 'button-danger' : 'button-primary'}`}
              onClick={confirm} disabled={busy} autoFocus>{CONFIRM[pending.action]}</button>
            <button id="cancel-control" type="button" className="button button-quiet" onClick={() => setPending(null)} disabled={busy}>Keep current state</button>
          </div>
        </div>
      )}
    </section>
  );
}
