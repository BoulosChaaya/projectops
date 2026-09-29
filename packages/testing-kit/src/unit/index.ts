// EXEC-TEST-001: Automated Unit Verification
import assert from 'node:assert/strict';
import test from 'node:test';

export type UnitTestFn = () => void | Promise<void>;

export function unitTest(name: string, fn: UnitTestFn): void {
  test(name, async () => {
    await fn();
  });
}

export { assert };
