// Dead-Letter Job Replay
import type { DeadLetterQueue } from './index.ts';
import type { JobEnvelope } from '../contracts/job.ts';

export async function replayDeadLetterJob(
  dlq: DeadLetterQueue,
  jobId: string,
  reEnqueue: (job: JobEnvelope) => Promise<void>,
  nowMs: number = Date.now()
): Promise<JobEnvelope> {
  const entry = dlq.getById(jobId);
  if (!entry) {
    throw new Error(`Dead-letter job "${jobId}" not found.`);
  }
  if (entry.failureCategory === 'poison_pill') {
    throw new Error(`Cannot replay poison-pill job "${jobId}" without payload repair.`);
  }

  const resetJob: JobEnvelope = Object.freeze({
    ...entry.job,
    attemptsMade: 0,
    availableAtMs: nowMs,
  });

  await reEnqueue(resetJob);
  dlq.remove(jobId);
  return resetJob;
}
