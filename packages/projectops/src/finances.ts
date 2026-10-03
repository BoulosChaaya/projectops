/** Aggregate cents are decimal strings: PostgreSQL SUM(integer) may exceed Number's safe range. */
export interface ProjectFinanceTotals {
  readonly outstandingInvoiceAmountCents: string;
  readonly paidInvoiceAmountCents: string;
  readonly submittedExpenseAmountCents: string;
  readonly approvedExpenseAmountCents: string;
}
export type ProjectFinanceTotalsByCurrency = Readonly<Record<string, ProjectFinanceTotals>>;
export const financeTotalKeys = Object.freeze([
  'outstandingInvoiceAmountCents', 'paidInvoiceAmountCents',
  'submittedExpenseAmountCents', 'approvedExpenseAmountCents',
] as const);
const zero = () => ({ outstandingInvoiceAmountCents: '0', paidInvoiceAmountCents: '0', submittedExpenseAmountCents: '0', approvedExpenseAmountCents: '0' });

export function mergeFinanceTotals(groups: readonly ProjectFinanceTotalsByCurrency[]): ProjectFinanceTotalsByCurrency {
  const result: Record<string, ProjectFinanceTotals> = {};
  for (const group of groups) for (const [currency, totals] of Object.entries(group)) {
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid aggregate currency.');
    const current = result[currency] ?? zero();
    const next = zero();
    for (const key of financeTotalKeys) {
      if (!/^\d+$/.test(totals[key])) throw new Error('Invalid decimal-cent aggregate.');
      next[key] = (BigInt(current[key]) + BigInt(totals[key])).toString();
    }
    result[currency] = Object.freeze(next);
  }
  return Object.freeze(result);
}

export function totalProjectFinances(
  invoices: readonly { readonly amountCents: number; readonly currency: string; readonly status: string }[],
  expenses: readonly { readonly amountCents: number; readonly currency: string; readonly status: string }[]
): ProjectFinanceTotalsByCurrency {
  const totals: Record<string, ProjectFinanceTotals> = {};
  for (const [rows, states] of [[invoices, { issued: 'outstandingInvoiceAmountCents', paid: 'paidInvoiceAmountCents' }],
    [expenses, { submitted: 'submittedExpenseAmountCents', approved: 'approvedExpenseAmountCents' }]] as const) {
    for (const row of rows) {
      const key = (states as Record<string, keyof ProjectFinanceTotals>)[row.status];
      if (!key) continue;
      const current = totals[row.currency] ?? zero();
      totals[row.currency] = { ...current, [key]: (BigInt(current[key]) + BigInt(row.amountCents)).toString() };
    }
  }
  return mergeFinanceTotals([totals]);
}

export function formatFinanceCents(cents: string | number, currency: string): string {
  const value = BigInt(cents);
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${currency} ${sign}${(absolute / 100n).toLocaleString('en')}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function formatFinanceTotal(totals: ProjectFinanceTotalsByCurrency, key: keyof ProjectFinanceTotals): string {
  return Object.keys(totals).sort().map(currency => formatFinanceCents(totals[currency][key], currency)).join('; ') || 'No recorded amounts';
}
