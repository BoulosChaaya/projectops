// EXEC-FOUND-003: Runtime Lifecycle State Model
export type LifecycleState = 'starting' | 'accepting' | 'draining' | 'stopping' | 'stopped';

const LEGAL_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = Object.freeze({
  starting: Object.freeze(['accepting', 'stopping', 'stopped']),
  accepting: Object.freeze(['draining', 'stopping']),
  draining: Object.freeze(['stopping']),
  stopping: Object.freeze(['stopped']),
  stopped: Object.freeze([]),
});

export class LifecycleStateMachine {
  private currentState: LifecycleState = 'starting';
  private readonly history: Array<{ from: LifecycleState; to: LifecycleState; atMs: number }> = [];

  public getState(): LifecycleState {
    return this.currentState;
  }

  public getHistory(): ReadonlyArray<{ from: LifecycleState; to: LifecycleState; atMs: number }> {
    return Object.freeze([...this.history]);
  }

  public canTransitionTo(next: LifecycleState): boolean {
    return LEGAL_TRANSITIONS[this.currentState].includes(next);
  }

  public transitionTo(next: LifecycleState, nowMs: number = Date.now()): LifecycleState {
    if (!this.canTransitionTo(next)) {
      throw new Error(`Illegal lifecycle state transition: ${this.currentState} -> ${next}`);
    }
    const prev = this.currentState;
    this.currentState = next;
    this.history.push({ from: prev, to: next, atMs: nowMs });
    return this.currentState;
  }
}

export const runtimeLifecycleStateModel = {
  LEGAL_TRANSITIONS,
  createStateMachine: () => new LifecycleStateMachine(),
};
