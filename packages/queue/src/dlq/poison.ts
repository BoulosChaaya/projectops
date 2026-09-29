// Poison-Pill Job Detection
export class PoisonPillError extends Error {
  public readonly code = 'POISON_PILL_PAYLOAD';
  public readonly poison = true;

  constructor(reason: string) {
    super(`Poison-pill job payload rejected: ${reason}`);
    this.name = 'PoisonPillError';
  }
}

export function assertNotPoisonPayload(rawPayload: unknown): void {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    throw new PoisonPillError('Payload is not a valid object.');
  }
  if ((rawPayload as Record<string, unknown>).__poison === true) {
    throw new PoisonPillError('Payload flagged with poison marker.');
  }
}
