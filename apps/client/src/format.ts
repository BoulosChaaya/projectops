import type { ProjectRequestStatus } from '../../../packages/projectops/src/domain.ts';

const STATUS_LABELS: Readonly<Record<ProjectRequestStatus, string>> = {
  new: 'New', estimated: 'Estimated', approved: 'Approved', in_progress: 'In progress',
  on_hold: 'On hold', cancelled: 'Cancelled', delivered: 'Delivered', archived: 'Archived',
};

export function statusLabel(status: ProjectRequestStatus): string {
  return STATUS_LABELS[status];
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * A date and time in the operator's saved timezone, never the browser's: the operator and the
 * server agree on what "due at 2 PM" means wherever the page is opened.
 */
export function formatDateTime(iso: string, timezone: string): string {
  let format = dateTimeFormats.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone });
    dateTimeFormats.set(timezone, format);
  }
  return format.format(new Date(iso));
}

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en')} ${count === 1 ? one : many}`;
}

export function formatHours(minutes: number): string {
  return `${(minutes / 60).toLocaleString('en', { maximumFractionDigits: 1 })} h`;
}
