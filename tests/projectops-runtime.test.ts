import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProjectOpsRuntimeConfig } from '../apps/api/src/projectops/postgres-app.ts';

test('ProjectOps runtime rejects missing/invalid configuration without leaking the URL', () => {
  assert.throws(() => readProjectOpsRuntimeConfig({}), /DATABASE_URL is required/);
  assert.throws(() => readProjectOpsRuntimeConfig({ DATABASE_URL: 'secret' }), /Invalid DATABASE_URL/);
  assert.throws(() => readProjectOpsRuntimeConfig({ DATABASE_URL: 'https://host/db' }), /PostgreSQL/);
  for (const port of ['-1', '1.5', '65536', 'abc', '']) {
    assert.throws(() => readProjectOpsRuntimeConfig({ DATABASE_URL: 'postgres://host/db', PORT: port }), /PORT/);
  }
  assert.equal(readProjectOpsRuntimeConfig({ DATABASE_URL: 'postgres://host/db' }).host, '127.0.0.1');
});
