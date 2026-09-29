// Verification Suite for Layer 6: CLIENT (EXEC-CLIENT-001..026: User-Facing Interface)
import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import {
  extractClientSafeEnv,
  stripServerOnlyFields,
  sanitizeRedirectTarget,
} from '../apps/web/src/security/trust-boundary.ts';
import { OptimisticMutationController } from '../apps/web/src/data/api-client.ts';
import {
  selectRenderingStrategy,
  buildCacheControlHeader,
  fingerprintStaticAsset,
} from '../apps/web/src/rendering/policy.ts';

unitTest('EXEC-CLIENT-001..026: Client trust boundary, open-redirect defense, optimistic rollback & cache-control policy', async () => {
  const safeEnv = extractClientSafeEnv({
    DATABASE_URL: 'postgres://secret',
    NEXT_PUBLIC_API_URL: 'https://api.uruk.dev',
  });
  assert.deepEqual(safeEnv, { NEXT_PUBLIC_API_URL: 'https://api.uruk.dev' });
  assert.throws(() => extractClientSafeEnv({ NEXT_PUBLIC_SECRET_KEY: 'leaked' }), /Security violation/);

  const dto = stripServerOnlyFields(
    { id: 'usr-1', email: 'enki@uruk.dev', passwordHash: 'scrypt$secret' },
    ['id', 'email']
  );
  assert.deepEqual(dto, { id: 'usr-1', email: 'enki@uruk.dev' });

  assert.equal(sanitizeRedirectTarget('/settings/profile'), '/settings/profile');
  assert.equal(sanitizeRedirectTarget('//evil.example.com'), '/dashboard');
  assert.equal(sanitizeRedirectTarget('https://evil.example.com'), '/dashboard');
  assert.equal(sanitizeRedirectTarget('javascript:alert(1)'), '/dashboard');

  const controller = new OptimisticMutationController({ likes: 10 });
  const failedMut = await controller.mutate({ likes: 11 }, async () => {
    throw new Error('500 Server Error');
  });
  assert.equal(failedMut.committed, false);
  assert.deepEqual(controller.getState(), { likes: 10 });

  assert.equal(selectRenderingStrategy('authenticated_dashboard'), 'dynamic_ssr');
  assert.match(buildCacheControlHeader({ authenticated: true }), /private, no-cache, no-store/);
  assert.match(buildCacheControlHeader({ authenticated: false, immutableAsset: true }), /immutable/);

  const f1 = fingerprintStaticAsset('app.js', 'console.log("v1")');
  const f2 = fingerprintStaticAsset('app.js', 'console.log("v2")');
  assert.notEqual(f1, f2);
});
