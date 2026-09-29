// EXEC-SEC-016..024: Deny-by-Default RBAC, Ownership & Privilege Escalation Guard
import type { AuthenticatedPrincipal } from '../session/index.ts';

export class AuthorizationError extends Error {
  public readonly status: 401 | 403;
  public readonly code: string;

  constructor(status: 401 | 403, code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'AuthorizationError';
    this.status = status;
    this.code = code;
  }
}

const ROLE_HIERARCHY: Readonly<Record<string, number>> = Object.freeze({
  viewer: 10,
  member: 20,
  admin: 30,
  system_operator: 40,
});

export class AccessControlEngine {
  private readonly rolePermissions = new Map<string, Set<string>>();

  constructor(policy: Readonly<Record<string, readonly string[]>> = {}) {
    for (const [role, perms] of Object.entries(policy)) {
      this.rolePermissions.set(role, new Set(perms));
    }
  }

  public assertPermission(
    principal: AuthenticatedPrincipal | null,
    requiredPermission: string
  ): void {
    if (!principal) {
      throw new AuthorizationError(401, 'UNAUTHENTICATED', 'Authentication is required.');
    }
    const allowed = principal.roles.some((role) =>
      this.rolePermissions.get(role)?.has(requiredPermission)
    );
    if (!allowed) {
      throw new AuthorizationError(
        403,
        'INSUFFICIENT_PERMISSIONS',
        `Principal lacks required permission ${requiredPermission}.`
      );
    }
  }

  public assertResourceOwnership(
    principal: AuthenticatedPrincipal | null,
    resource: { readonly ownerId: string; readonly tenantId: string }
  ): void {
    if (!principal) {
      throw new AuthorizationError(401, 'UNAUTHENTICATED', 'Authentication is required.');
    }
    if (principal.tenantId !== resource.tenantId) {
      throw new AuthorizationError(
        403,
        'CROSS_TENANT_ACCESS_DENIED',
        'Cross-tenant resource access is forbidden.'
      );
    }
    const isAdmin = principal.roles.includes('admin') || principal.roles.includes('system_operator');
    if (principal.principalId !== resource.ownerId && !isAdmin) {
      throw new AuthorizationError(
        403,
        'RESOURCE_OWNERSHIP_DENIED',
        'Principal does not own the target resource.'
      );
    }
  }

  public assertNoPrivilegeEscalation(
    actor: AuthenticatedPrincipal,
    targetPrincipalId: string,
    requestedRoles: readonly string[]
  ): void {
    if (actor.principalId === targetPrincipalId) {
      throw new AuthorizationError(
        403,
        'SELF_PRIVILEGE_ESCALATION_FORBIDDEN',
        'Principals cannot elevate their own roles.'
      );
    }
    const actorMaxRank = Math.max(0, ...actor.roles.map((r) => ROLE_HIERARCHY[r] ?? 0));
    for (const targetRole of requestedRoles) {
      const targetRank = ROLE_HIERARCHY[targetRole] ?? 999;
      if (targetRank >= actorMaxRank && !actor.roles.includes('system_operator')) {
        throw new AuthorizationError(
          403,
          'PRIVILEGE_BOUNDARY_VIOLATION',
          `Actor cannot grant role ${targetRole}.`
        );
      }
    }
  }
}
