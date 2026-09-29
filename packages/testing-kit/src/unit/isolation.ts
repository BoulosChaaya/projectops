// EXEC-TEST-002: Isolated Logic Testing
export interface IsolatedClock {
  nowMs(): number;
  nowIso(): string;
  advanceMs(deltaMs: number): void;
}

export interface IsolatedTestContext {
  clock: IsolatedClock;
  env: Record<string, string | undefined>;
}

export async function testIsolated<T>(
  fn: (ctx: IsolatedTestContext) => T | Promise<T>,
  initialIso = '2026-09-28T12:00:00.000Z',
  initialEnv: Record<string, string | undefined> = {}
): Promise<T> {
  let currentMs = new Date(initialIso).getTime();
  const clock: IsolatedClock = {
    nowMs: () => currentMs,
    nowIso: () => new Date(currentMs).toISOString(),
    advanceMs: (deltaMs: number) => {
      currentMs += deltaMs;
    },
  };
  const envCopy: Record<string, string | undefined> = { ...initialEnv };
  return await fn({ clock, env: envCopy });
}
