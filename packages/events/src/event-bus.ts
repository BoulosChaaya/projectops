// EXEC-ARCH-025..033: Schema-Versioned Domain Event Bus & Deduplicated Consumer
export interface DomainEvent<TPayload = Record<string, unknown>> {
  readonly eventId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly payload: Readonly<TPayload>;
}

export class VersionedEventBus {
  private readonly processedEventIds = new Set<string>();
  private readonly subscribers = new Map<string, Array<(evt: DomainEvent) => Promise<void>>>();

  public subscribe(eventType: string, handler: (evt: DomainEvent) => Promise<void>): void {
    const list = this.subscribers.get(eventType) ?? [];
    list.push(handler);
    this.subscribers.set(eventType, list);
  }

  public async publish(event: DomainEvent): Promise<{ delivered: number; deduplicated: boolean }> {
    if (this.processedEventIds.has(event.eventId)) {
      return Object.freeze({ delivered: 0, deduplicated: true });
    }
    this.processedEventIds.add(event.eventId);
    const handlers = this.subscribers.get(event.eventType) ?? [];
    for (const h of handlers) {
      await h(event);
    }
    return Object.freeze({ delivered: handlers.length, deduplicated: false });
  }
}
