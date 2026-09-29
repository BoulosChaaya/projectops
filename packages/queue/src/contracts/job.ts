// Queue Job Contract, Payload Validation & Size Bounds
import crypto from 'node:crypto';

export const MAX_JOB_PAYLOAD_BYTES = 65_536; // 64 KiB

export interface JobEnvelope<TPayload = Record<string, unknown>> {
  readonly jobId: string;
  readonly queueName: string;
  readonly jobName: string;
  readonly idempotencyKey: string;
  readonly payload: Readonly<TPayload>;
  readonly attemptsMade: number;
  readonly maxAttempts: number;
  readonly createdAtMs: number;
  readonly availableAtMs: number;
  readonly partitionKey?: string;
  readonly correlationId?: string;
}

export interface CreateJobInput<TPayload = Record<string, unknown>> {
  readonly queueName: string;
  readonly jobName: string;
  readonly idempotencyKey: string;
  readonly payload: TPayload;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly partitionKey?: string;
  readonly correlationId?: string;
  readonly nowMs?: number;
}

export function createJobEnvelope<TPayload extends Record<string, unknown>>(
  input: CreateJobInput<TPayload>
): JobEnvelope<TPayload> {
  if (!input.queueName || typeof input.queueName !== 'string') {
    throw new Error('queueName is required.');
  }
  if (!input.jobName || typeof input.jobName !== 'string') {
    throw new Error('jobName is required.');
  }
  if (!input.idempotencyKey || typeof input.idempotencyKey !== 'string') {
    throw new Error('idempotencyKey is required for at-least-once job safety.');
  }
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new Error('Job payload must be a plain JSON object.');
  }

  const serialized = JSON.stringify(input.payload);
  const byteLen = Buffer.byteLength(serialized, 'utf8');
  if (byteLen > MAX_JOB_PAYLOAD_BYTES) {
    throw new Error(`Job payload size ${byteLen}B exceeds limit of ${MAX_JOB_PAYLOAD_BYTES}B.`);
  }

  const nowMs = input.nowMs ?? Date.now();
  const delayMs = input.delayMs ?? 0;
  if (delayMs < 0) {
    throw new Error('Job delayMs cannot be negative.');
  }

  return Object.freeze({
    jobId: `job_${crypto.randomUUID()}`,
    queueName: input.queueName,
    jobName: input.jobName,
    idempotencyKey: input.idempotencyKey,
    payload: Object.freeze(JSON.parse(serialized) as TPayload),
    attemptsMade: 0,
    maxAttempts: input.maxAttempts ?? 3,
    createdAtMs: nowMs,
    availableAtMs: nowMs + delayMs,
    ...(input.partitionKey ? { partitionKey: input.partitionKey } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  });
}
