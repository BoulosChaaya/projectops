import type { FormEvent } from 'react';
import { useCollection, useSectionAction, useWorkspace } from './context.tsx';
import { CreatePanel, RecordsSection } from './records-section.tsx';
import { RecordChoice } from './delivery.tsx';
import { fromUtcInput, money, optional } from './format.ts';
import { Check, Input, Select, TextArea } from './inputs.tsx';
import type { Row } from './record-card.tsx';

type Kind = 'invoices' | 'expenses';

const CATEGORIES: Readonly<Record<Kind, readonly (readonly [string, string])[]>> = {
  invoices: [['issued', 'Outstanding invoices'], ['paid', 'Paid invoices']],
  expenses: [['submitted', 'Submitted expenses'], ['approved', 'Approved expenses']],
};

/** "1.00 EUR; 5.00 USD" for the rows in a state, or '' when there are none. */
export function sumByCurrency(rows: readonly Row[], state: string): string {
  const sums = new Map<string, bigint>();
  for (const row of rows) if (row.status === state) sums.set(String(row.currency), (sums.get(String(row.currency)) ?? 0n) + BigInt(row.amountCents as string));
  return [...sums.keys()].sort().map(currency => money(sums.get(currency)!.toString(), currency)).join('; ');
}

/** Totals per currency and state. Currencies are never converted or added together. */
export function Totals() {
  const totals = { invoices: useCollection('invoices'), expenses: useCollection('expenses') };
  return (
    <section id="finance-totals" className="ws-section" aria-labelledby="finance-totals-title">
      <h2 id="finance-totals-title">Finance totals by currency</h2>
      <p className="ws-help">Each currency is reported separately. No currency conversion or combined total.</p>
      <div id="finance-totals-status" className="ws-totals" role="status" aria-live="polite">
        {(['invoices', 'expenses'] as const).flatMap(kind => CATEGORIES[kind].map(([state, title]) => {
          const records = totals[kind];
          let text: string;
          if (records.state !== 'ready') text = `${title}: unavailable until ${kind} load. Retry the failed section.`;
          else {
            text = `${title}: ${sumByCurrency(records.rows, state) || 'No recorded amounts'}`;
          }
          return <p key={`${state}-${kind}`} data-total={`${state}-${kind}`}>{text}</p>;
        }))}
      </div>
    </section>
  );
}

function can(kind: Kind, action: 'create' | 'act', status: string): boolean {
  const states = action === 'act' ? ['new', 'estimated', 'approved', 'in_progress', 'on_hold', 'delivered']
    : kind === 'invoices' ? ['approved', 'in_progress', 'delivered'] : ['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'];
  return states.includes(status);
}

const DONE = { pay: 'Invoice paid.', approve: 'Expense approved.', reject: 'Expense rejected.' } as const;

function FinanceSection({ kind }: { kind: Kind }) {
  const { project, session, write } = useWorkspace();
  const { status, busy, run } = useSectionAction(kind);
  const singular = kind === 'invoices' ? 'invoice' : 'expense';
  const allowed = can(kind, 'create', project.status), canAct = can(kind, 'act', project.status);
  const currency = session.defaults.defaultCurrency;
  const help = allowed ? `Create and manage ${kind}.`
    : canAct ? 'Creation is unavailable in this project state. Existing records can still be acted on.'
    : 'Records are read-only in this project state.';

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    const body = { id: crypto.randomUUID(), amountCents: Number(data.get('amountCents')), currency: data.get('currency'),
      ...(kind === 'invoices'
        ? { invoiceNumber: data.get('invoiceNumber'), deliverableId: optional(data.get('deliverableId')), dueAtIso: fromUtcInput(data.get('dueAtIso')) }
        : { category: data.get('category'), description: data.get('description'), vendor: optional(data.get('vendor')), reimbursable: data.get('reimbursable') === 'on',
            receiptUrl: optional(data.get('receiptUrl')), incurredAtIso: fromUtcInput(data.get('incurredAtIso')) }) };
    void run(async () => { await write('POST', kind, body); form.reset(); }, kind === 'invoices' ? 'Invoice issued.' : 'Expense submitted.');
  }
  function act(row: Row, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value as keyof typeof DONE | undefined;
    if (!action) return;
    const data = new FormData(event.currentTarget);
    void run(() => write('POST', `${kind}/${encodeURIComponent(row.id)}/${action}`, kind === 'expenses' ? { decisionNote: optional(data.get('decisionNote')) } : {}), DONE[action]);
  }

  return (
    <RecordsSection path={kind} label={kind === 'invoices' ? 'Invoices' : 'Expenses'} help={help} helpId={`${singular}-finance-help`}
      statusId={`${singular}-finance-status`} status={status} recordClass="finance-record"
      fields={kind === 'invoices'
        ? ['invoiceNumber', 'deliverableId', 'amountCents', 'currency', 'status', 'issuedAtIso', 'dueAtIso', 'paidAtIso']
        : ['description', 'category', 'vendor', 'amountCents', 'currency', 'reimbursable', 'receiptUrl', 'incurredAtIso', 'status', 'decidedBy', 'decidedAtIso', 'decisionNote']}
      form={kind === 'invoices' ? (
        <CreatePanel summary="New invoice" allowed={allowed}>
        <form id="create-invoice" className="ws-form" onSubmit={create}>
          <Input label="Invoice number" name="invoiceNumber" maxLength={80} required />
          <Input label="Amount (integer cents)" name="amountCents" type="number" min={1} max={1_000_000_000} step={1} required />
          <Input label="Currency" name="currency" maxLength={3} required defaultValue={currency} className="input-short" />
          <RecordChoice label="Accepted deliverable (optional)" name="deliverableId" empty="No deliverable" path="deliverables"
            filter={row => row.status === 'accepted'} retryId="retry-finance-deliverables" retryText="Retry accepted deliverable choices"
            unavailable="Deliverables unavailable — retry to select" />
          <Input label="Due date/time (UTC, optional)" name="dueAtIso" type="datetime-local" step={1} />
          <div className="form-actions"><button className="button button-primary" disabled={busy}>Issue invoice</button></div>
        </form>
        </CreatePanel>
      ) : (
        <CreatePanel summary="New expense" allowed={allowed}>
        <form id="create-expense" className="ws-form" onSubmit={create}>
          <Select label="Category" aria-label="Category" name="category" choices={['software', 'asset', 'service', 'travel', 'other']} defaultValue="other" />
          <TextArea label="Description" name="description" maxLength={500} required />
          <Input label="Vendor (optional)" name="vendor" maxLength={120} />
          <Input label="Amount (integer cents)" name="amountCents" type="number" min={1} max={1_000_000_000} step={1} required />
          <Input label="Currency" name="currency" maxLength={3} required defaultValue={currency} className="input-short" />
          <Check label="Reimbursable" name="reimbursable" defaultChecked />
          <Input label="HTTP(S) receipt URL (optional)" name="receiptUrl" type="url" maxLength={2048} />
          <Input label="Incurred date/time (UTC, optional; defaults to now)" name="incurredAtIso" type="datetime-local" step={1} />
          <div className="form-actions"><button className="button button-primary" disabled={busy}>Submit expense</button></div>
        </form>
        </CreatePanel>
      )}
      actions={row => {
        if (!canAct || row.status !== (kind === 'invoices' ? 'issued' : 'submitted')) return null;
        return (
          <form className="finance-action ws-action-form" onSubmit={event => act(row, event)}>
            {kind === 'expenses' && <Input label="Decision note (optional)" name="decisionNote" maxLength={500} />}
            {kind === 'invoices'
              ? <button className="button button-secondary" name="action" value="pay" disabled={busy}>Record payment</button>
              : <div className="ws-actions">
                <button className="button button-secondary" name="action" value="approve" disabled={busy}>Approve expense</button>
                <button className="button button-quiet" name="action" value="reject" disabled={busy}>Reject expense</button>
              </div>}
          </form>
        );
      }}
    />
  );
}

export function Finances() {
  return <><Totals /><FinanceSection kind="invoices" /><FinanceSection kind="expenses" /></>;
}
