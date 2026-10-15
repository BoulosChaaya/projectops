// Keyset page shapes. Platform-neutral (no Node APIs), so the browser client imports them too.

export interface PageRequest {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** Pass back as `cursor` to read the next page; null on the last page. */
  readonly nextCursor: string | null;
}
