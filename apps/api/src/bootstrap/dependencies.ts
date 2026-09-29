// EXEC-FOUND-005: Dependency Initialization Order
export interface DependencyUnit {
  readonly name: string;
  readonly dependsOn?: readonly string[];
  init(): Promise<void> | void;
}

export interface Dependencies {
  readonly initializedOrder: readonly string[];
}

export async function initializeDependencies(
  units: readonly DependencyUnit[]
): Promise<Dependencies> {
  const byName = new Map<string, DependencyUnit>();
  for (const unit of units) {
    byName.set(unit.name, unit);
  }

  const initialized = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];

  async function initUnit(name: string): Promise<void> {
    if (initialized.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular dependency initialization detected at "${name}".`);
    }
    const unit = byName.get(name);
    if (!unit) {
      throw new Error(`Unknown prerequisite dependency "${name}".`);
    }

    visiting.add(name);
    for (const prereq of unit.dependsOn ?? []) {
      await initUnit(prereq);
    }
    await unit.init();
    visiting.delete(name);
    initialized.add(name);
    order.push(name);
  }

  for (const unit of units) {
    await initUnit(unit.name);
  }

  return Object.freeze({
    initializedOrder: Object.freeze(order),
  });
}
