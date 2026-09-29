// EXEC-FOUND-004: Environment Variable Loading
export type Environment = Readonly<Record<string, string | undefined>>;

export function loadEnvironment(
  source: Record<string, string | undefined> = process.env
): Environment {
  const snapshot: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    snapshot[key] = typeof value === 'string' ? value : undefined;
  }
  return Object.freeze(snapshot);
}
