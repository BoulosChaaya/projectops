// EXEC-CLIENT-006..011: Typed Client Fetching & Optimistic UI Rollback
export class OptimisticMutationController<TState> {
  private committedState: TState;
  private visibleState: TState;

  constructor(initialState: TState) {
    this.committedState = initialState;
    this.visibleState = initialState;
  }

  public getState(): TState {
    return this.visibleState;
  }

  public async mutate(
    optimisticValue: TState,
    serverMutation: () => Promise<TState>
  ): Promise<{ committed: boolean; state: TState }> {
    const snapshot = this.committedState;
    this.visibleState = optimisticValue;
    try {
      const confirmed = await serverMutation();
      this.committedState = confirmed;
      this.visibleState = confirmed;
      return Object.freeze({ committed: true, state: this.visibleState });
    } catch {
      this.visibleState = snapshot;
      return Object.freeze({ committed: false, state: this.visibleState });
    }
  }
}
