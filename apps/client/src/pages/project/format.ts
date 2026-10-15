// Formatting used inside the project workspace. Money keeps the workspace's "1234.50 EUR" form
// (exact cents from decimal strings, never floating point); dates are in the operator's timezone
// and name it, because the workspace mixes dates entered in UTC with dates shown locally.

export function money(cents: string | number, currency?: string): string {
  const value = BigInt(cents);
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')} ${currency ?? ''}`.trimEnd();
}

const formats = new Map<string, Intl.DateTimeFormat>();
export function workspaceDate(iso: string, timezone: string): string {
  let format = formats.get(timezone);
  if (!format) formats.set(timezone, format = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }));
  return `${format.format(new Date(iso))} (${timezone})`;
}

/** datetime-local value for an instant, in UTC (the workspace's date inputs are UTC). */
export function utcInput(iso?: string): string {
  return iso ? new Date(iso).toISOString().slice(0, 19) : '';
}
/** ISO instant from a UTC datetime-local value; undefined when empty. */
export function fromUtcInput(value: FormDataEntryValue | null | undefined): string | undefined {
  const text = String(value ?? '');
  return text ? new Date(`${text}Z`).toISOString() : undefined;
}
export function optional(value: FormDataEntryValue | null | undefined): string | undefined {
  return String(value ?? '').trim() || undefined;
}

const LABELS: Readonly<Record<string, string>> = {
  amountCents: 'Amount', estimateDeltaCents: 'Estimate change', budgetRange: 'Budget range', artifactUrl: 'Artifact',
  url: 'Link', body: 'Note', dueAtIso: 'Due', createdAtIso: 'Created', loggedAtIso: 'Logged', happenedAtIso: 'Occurred',
};
export function fieldLabel(key: string): string {
  return LABELS[key] ?? key.replace(/Iso$/, '').replace(/([A-Z])/g, ' $1').toLowerCase();
}

/** Only absolute http(s) URLs without credentials become links; anything else is shown as text. */
export function safeHref(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
