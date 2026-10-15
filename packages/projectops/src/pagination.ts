import { ProjectOpsValidationError } from './domain.ts';

/**
 * Keyset (cursor) pagination for global lists.
 *
 * Why keyset rather than LIMIT/OFFSET: OFFSET re-reads and discards every
 * earlier row, so late pages get slower, and a row inserted while someone
 * pages shifts everything by one (a row is shown twice or skipped). A keyset
 * cursor remembers the sort key of the last row seen, so each page is an
 * indexed range read that starts exactly after it.
 *
 * Cursors are opaque to clients (base64url JSON) and tagged with the list
 * they belong to, so a clients cursor cannot be replayed against projects.
 *
 * Invariant: sort-key timestamps are written by the application from
 * JavaScript ISO strings, so they have millisecond precision in PostgreSQL.
 * Cursors therefore carry exact values; decoding rejects non-canonical ones.
 */

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

// Page shapes live in page.ts (platform-neutral, shared with the browser client); re-exported here.
export type { PageRequest, Page } from './page.ts';
import type { PageRequest, Page } from './page.ts';

/** Position after the last client seen; clients sort by created_at DESC, id ASC. */
export interface ClientPageKey {
  readonly createdAtIso: string;
  readonly id: string;
}

/** Position after the last project seen; projects sort by updated_at DESC, created_at DESC, id ASC. */
export interface ProjectRequestPageKey {
  readonly updatedAtIso: string;
  readonly createdAtIso: string;
  readonly id: string;
}

export interface ValidatedPage<K> {
  readonly limit: number;
  readonly after?: K;
}

type CursorList = 'clients' | 'project-requests';

function invalid(code: string, message: string): never {
  throw new ProjectOpsValidationError(code, message);
}

export function validatePageLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE_LIMIT;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    invalid('INVALID_PAGE_LIMIT', `limit must be an integer from 1 to ${MAX_PAGE_LIMIT}.`);
  }
  return value;
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') invalid('INVALID_PAGE_CURSOR', 'Invalid page cursor.');
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) invalid('INVALID_PAGE_CURSOR', 'Invalid page cursor.');
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200 || !identifierPattern.test(value)) {
    invalid('INVALID_PAGE_CURSOR', 'Invalid page cursor.');
  }
  return value;
}

function encodeCursor(list: CursorList, keys: readonly string[]): string {
  return Buffer.from(JSON.stringify({ v: 1, list, keys }), 'utf8').toString('base64url');
}

function decodeCursor(list: CursorList, cursor: unknown, keyCount: number): readonly unknown[] {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    invalid('INVALID_PAGE_CURSOR', 'Invalid page cursor.');
  }
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { invalid('INVALID_PAGE_CURSOR', 'Invalid page cursor.'); }
  if (typeof payload !== 'object' || payload === null) invalid('INVALID_PAGE_CURSOR', 'Invalid page cursor.');
  const { v, list: cursorList, keys } = payload as { v?: unknown; list?: unknown; keys?: unknown };
  if (v !== 1 || cursorList !== list || !Array.isArray(keys) || keys.length !== keyCount) {
    invalid('INVALID_PAGE_CURSOR', 'Invalid page cursor.');
  }
  return keys;
}

export function validateClientPage(page: PageRequest = {}): ValidatedPage<ClientPageKey> {
  const limit = validatePageLimit(page.limit);
  if (page.cursor === undefined) return { limit };
  const [createdAtIso, id] = decodeCursor('clients', page.cursor, 2);
  return { limit, after: { createdAtIso: canonicalTimestamp(createdAtIso), id: identifier(id) } };
}

export function validateProjectRequestPage(page: PageRequest = {}): ValidatedPage<ProjectRequestPageKey> {
  const limit = validatePageLimit(page.limit);
  if (page.cursor === undefined) return { limit };
  const [updatedAtIso, createdAtIso, id] = decodeCursor('project-requests', page.cursor, 3);
  return { limit, after: { updatedAtIso: canonicalTimestamp(updatedAtIso), createdAtIso: canonicalTimestamp(createdAtIso), id: identifier(id) } };
}

export function clientPageCursor(row: ClientPageKey): string {
  return encodeCursor('clients', [row.createdAtIso, row.id]);
}

export function projectRequestPageCursor(row: ProjectRequestPageKey): string {
  return encodeCursor('project-requests', [row.updatedAtIso, row.createdAtIso, row.id]);
}

/**
 * Turn a `limit + 1` query result into a page: the extra row only proves another
 * page exists, and the cursor points after the last row actually returned.
 */
export function toPage<T>(rows: readonly T[], limit: number, cursorFor: (row: T) => string): Page<T> {
  if (rows.length <= limit) return Object.freeze({ items: Object.freeze([...rows]), nextCursor: null });
  const items = Object.freeze(rows.slice(0, limit));
  return Object.freeze({ items, nextCursor: cursorFor(items[items.length - 1]!) });
}
