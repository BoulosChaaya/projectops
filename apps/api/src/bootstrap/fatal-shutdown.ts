// EXEC-FOUND-018: Graceful Shutdown on Fatal Error
import type { InFlightDrainer } from '../../../../packages/runtime/lifecycle/draining.ts';
import type { LifecycleStateMachine } from '../../../../packages/runtime/lifecycle/state.ts';
import type { FaultSignal } from '../../../../packages/runtime/src/faults/signal.ts';

export interface ShutdownResource {
  readonly name: string;
  close(): Promise<void> | void;
}

export interface FatalShutdownOptions {
  stateMachine: LifecycleStateMachine;
  drainer: InFlightDrainer;
  resources: readonly ShutdownResource[];
  deadlineMs?: number;
}

export async function shutdownOnFatal(
  _signal: FaultSignal,
  options: FatalShutdownOptions
): Promise<{ closedOrder: readonly string[]; timedOut: boolean }> {
  const deadlineMs = options.deadlineMs ?? 5000;

  if (options.stateMachine.canTransitionTo('draining')) {
    options.stateMachine.transitionTo('draining');
  }

  const drainResult = await options.drainer.drain(deadlineMs);

  if (options.stateMachine.canTransitionTo('stopping')) {
    options.stateMachine.transitionTo('stopping');
  }

  const closedOrder: string[] = [];
  const closedSet = new Set<string>();

  for (const resource of options.resources) {
    if (closedSet.has(resource.name)) continue;
    closedSet.add(resource.name);
    await resource.close();
    closedOrder.push(resource.name);
  }

  if (options.stateMachine.canTransitionTo('stopped')) {
    options.stateMachine.transitionTo('stopped');
  }

  return Object.freeze({
    closedOrder: Object.freeze(closedOrder),
    timedOut: !drainResult.completedGracefully,
  });
}
