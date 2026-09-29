// Job Failure Classification (Transient vs Permanent vs Poison)
export type JobFailureCategory = 'transient' | 'permanent' | 'poison_pill';

export interface ClassifiedJobFailure {
  readonly category: JobFailureCategory;
  readonly retryable: boolean;
  readonly reason: string;
}

export function classifyJobFailure(error: unknown): ClassifiedJobFailure {
  if (!error || typeof error !== 'object') {
    return Object.freeze({ category: 'permanent', retryable: false, reason: String(error) });
  }
  const err = error as { code?: string; transient?: boolean; poison?: boolean; message?: string };
  const message = err.message ?? 'Job execution failed';

  if (err.poison === true || err.code === 'POISON_PILL_PAYLOAD') {
    return Object.freeze({ category: 'poison_pill', retryable: false, reason: message });
  }
  if (
    err.transient === true ||
    ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', '40P01', '40001', '57P03'].includes(err.code ?? '')
  ) {
    return Object.freeze({ category: 'transient', retryable: true, reason: message });
  }
  return Object.freeze({ category: 'permanent', retryable: false, reason: message });
}
