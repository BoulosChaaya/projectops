// Verification Suite for Layer 5: SEC (EXEC-SEC-001..046: Protected System)
import crypto from 'node:crypto';
import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import { hashPassword, verifyPassword } from '../packages/auth/src/password/index.ts';
import { SessionManager } from '../packages/auth/src/session/index.ts';
import { AccessControlEngine } from '../packages/auth/src/rbac/index.ts';
import { FieldEncryptionKeyring } from '../packages/security/src/encryption/index.ts';
import {
  encodeUntrustedOutput,
  assertParameterizedSql,
  RateLimiter,
} from '../packages/security/src/defense/index.ts';
import { TamperEvidentAuditLog } from '../packages/security/src/audit/index.ts';

unitTest('EXEC-SEC-001..015: scrypt password hashing, CSPRNG session lifecycle, privilege rotation & revocation', () => {
  const hashed = hashPassword('correct-horse-battery-staple');
  assert.equal(verifyPassword('correct-horse-battery-staple', hashed), true);
  assert.equal(verifyPassword('wrong-password', hashed), false);

  const nowMs = 1700000000000;
  const sessions = new SessionManager({ idleTimeoutMs: 60000, absoluteTtlMs: 300000 });
  const issued = sessions.issueSession({
    principalId: 'usr-1',
    tenantId: 'ten-1',
    roles: ['member'],
    nowMs,
  });

  assert.match(issued.cookieHeader, /HttpOnly; Secure; SameSite=Strict/);
  const resolved = sessions.resolvePrincipal(issued.rawToken, nowMs + 10000);
  assert.equal(resolved?.principalId, 'usr-1');

  const rotated = sessions.rotateOnPrivilegeChange(issued.rawToken, ['member', 'admin'], nowMs + 20000);
  assert.equal(sessions.resolvePrincipal(issued.rawToken, nowMs + 20000), null);
  assert.deepEqual(sessions.resolvePrincipal(rotated.rawToken, nowMs + 20000)?.roles, [
    'member',
    'admin',
  ]);
  assert.equal(sessions.resolvePrincipal(rotated.rawToken, nowMs + 100000), null);
});

unitTest('EXEC-SEC-016..024: Deny-by-default RBAC, tenant/resource ownership, and privilege escalation prevention', () => {
  const rbac = new AccessControlEngine({
    member: ['orders:read', 'orders:write'],
    admin: ['orders:read', 'orders:write', 'users:manage'],
  });
  const member = {
    principalId: 'usr-1',
    tenantId: 'ten-1',
    roles: ['member'],
    sessionId: 's-1',
  };
  rbac.assertPermission(member, 'orders:read');
  assert.throws(() => rbac.assertPermission(member, 'users:manage'), /INSUFFICIENT_PERMISSIONS/);
  assert.throws(
    () => rbac.assertResourceOwnership(member, { ownerId: 'usr-1', tenantId: 'ten-2' }),
    /CROSS_TENANT_ACCESS_DENIED/
  );
  assert.throws(
    () => rbac.assertNoPrivilegeEscalation(member, 'usr-1', ['admin']),
    /SELF_PRIVILEGE_ESCALATION_FORBIDDEN/
  );
});

unitTest('EXEC-SEC-034..046: AES-256-GCM field encryption with key rotation, SQLi/XSS/Rate-Limit guards & HMAC audit chain', () => {
  const k1 = crypto.randomBytes(32);
  const k2 = crypto.randomBytes(32);
  const keyring = new FieldEncryptionKeyring('key-2025', k1);

  const cipher1 = keyring.encryptField('iban-LB99-0001', 'tenant:ten-1');
  assert.equal(cipher1.includes('iban-LB99-0001'), false);

  keyring.addKeyAndActivate('key-2026', k2);
  const dec1 = keyring.decryptField(cipher1, 'tenant:ten-1');
  assert.equal(dec1.plaintext, 'iban-LB99-0001');
  assert.equal(dec1.keyId, 'key-2025');

  const rotatedCipher = keyring.rotateCiphertext(cipher1, 'tenant:ten-1');
  const dec2 = keyring.decryptField(rotatedCipher, 'tenant:ten-1');
  assert.equal(dec2.keyId, 'key-2026');
  assert.throws(() => keyring.decryptField(rotatedCipher, 'tenant:wrong'));

  assert.equal(encodeUntrustedOutput('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assertParameterizedSql('SELECT * FROM users WHERE id = $1', ['usr-1']);
  assert.throws(() => assertParameterizedSql("SELECT * FROM users WHERE id = '1' OR '1'='1'", []), /SQL injection guard/);

  const limiter = new RateLimiter({ maxRequests: 2, windowMs: 10000 });
  assert.equal(limiter.consume('ip:1.2.3.4', 1000).allowed, true);
  assert.equal(limiter.consume('ip:1.2.3.4', 2000).allowed, true);
  assert.equal(limiter.consume('ip:1.2.3.4', 3000).allowed, false);

  const audit = new TamperEvidentAuditLog('super-secret-audit-hmac-key');
  audit.append({ actorId: 'usr-1', action: 'secret.read', resource: 'vault/db', outcome: 'allowed' });
  audit.append({ actorId: 'usr-2', action: 'role.grant', resource: 'usr-3', outcome: 'denied' });
  assert.equal(audit.verifyChain().valid, true);

  const tampered = [...audit.getRecords()];
  tampered[1] = { ...tampered[1], outcome: 'allowed' };
  assert.deepEqual(audit.verifyChain(tampered), { valid: false, brokenAtSequence: 2 });
});
