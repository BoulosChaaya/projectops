// EXEC-SEC-003..015: CSPRNG Opaque Session Lifecycle, Rotation & Revocation
import crypto from 'node:crypto';

export interface AuthenticatedPrincipal {
  readonly principalId: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
  readonly sessionId: string;
}

interface StoredSessionRecord {
  readonly sessionId: string;
  readonly tokenHash: string;
  readonly principalId: string;
  readonly tenantId: string;
  roles: readonly string[];
  readonly createdAtMs: number;
  lastActiveAtMs: number;
  readonly absoluteExpiresAtMs: number;
  readonly idleTimeoutMs: number;
  revoked: boolean;
}

function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export class SessionManager {
  private readonly byTokenHash = new Map<string, StoredSessionRecord>();
  private readonly idleTimeoutMs: number;
  private readonly absoluteTtlMs: number;

  constructor(options: { idleTimeoutMs?: number; absoluteTtlMs?: number } = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 1800000;
    this.absoluteTtlMs = options.absoluteTtlMs ?? 86400000;
  }

  public issueSession(input: {
    principalId: string;
    tenantId: string;
    roles: readonly string[];
    nowMs?: number;
  }): { rawToken: string; sessionId: string; cookieHeader: string } {
    const nowMs = input.nowMs ?? Date.now();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(rawToken);
    const sessionId = `sess_${crypto.randomUUID()}`;

    this.byTokenHash.set(tokenHash, {
      sessionId,
      tokenHash,
      principalId: input.principalId,
      tenantId: input.tenantId,
      roles: Object.freeze([...input.roles]),
      createdAtMs: nowMs,
      lastActiveAtMs: nowMs,
      absoluteExpiresAtMs: nowMs + this.absoluteTtlMs,
      idleTimeoutMs: this.idleTimeoutMs,
      revoked: false,
    });

    const maxAgeSec = Math.floor(this.absoluteTtlMs / 1000);
    const cookieHeader = `uruk_session=${rawToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
    return Object.freeze({ rawToken, sessionId, cookieHeader });
  }

  public resolvePrincipal(rawToken: string | undefined, nowMs: number = Date.now()): AuthenticatedPrincipal | null {
    if (!rawToken || typeof rawToken !== 'string') {
      return null;
    }
    const tokenHash = hashSessionToken(rawToken);
    const record = this.byTokenHash.get(tokenHash);
    if (!record || record.revoked) {
      return null;
    }
    if (nowMs >= record.absoluteExpiresAtMs || nowMs - record.lastActiveAtMs >= record.idleTimeoutMs) {
      record.revoked = true;
      this.byTokenHash.delete(tokenHash);
      return null;
    }
    record.lastActiveAtMs = nowMs;
    return Object.freeze({
      principalId: record.principalId,
      tenantId: record.tenantId,
      roles: record.roles,
      sessionId: record.sessionId,
    });
  }

  public rotateOnPrivilegeChange(
    oldRawToken: string,
    newRoles: readonly string[],
    nowMs: number = Date.now()
  ): { rawToken: string; sessionId: string; cookieHeader: string } {
    const current = this.resolvePrincipal(oldRawToken, nowMs);
    if (!current) {
      throw new Error('Cannot rotate an invalid or expired session.');
    }
    this.revokeToken(oldRawToken);
    return this.issueSession({
      principalId: current.principalId,
      tenantId: current.tenantId,
      roles: newRoles,
      nowMs,
    });
  }

  public revokeToken(rawToken: string): boolean {
    const tokenHash = hashSessionToken(rawToken);
    const rec = this.byTokenHash.get(tokenHash);
    if (!rec) return false;
    rec.revoked = true;
    this.byTokenHash.delete(tokenHash);
    return true;
  }
}
