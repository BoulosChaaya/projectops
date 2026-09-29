// EXEC-ARCH-034..041: Multi-Tenant Context Isolation & Per-Tenant Resource Quotas
export class TenantQuotaManager {
  private readonly maxPerTenant: number;
  private readonly usageByTenant = new Map<string, number>();

  constructor(maxPerTenant = 100) {
    this.maxPerTenant = maxPerTenant;
  }

  public consumeQuota(tenantId: string, units = 1): number {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('Explicit tenantId is required for multi-tenant isolation.');
    }
    const current = this.usageByTenant.get(tenantId) ?? 0;
    if (current + units > this.maxPerTenant) {
      throw new Error(`Tenant ${tenantId} exceeded allocated resource quota (${this.maxPerTenant}).`);
    }
    const updated = current + units;
    this.usageByTenant.set(tenantId, updated);
    return updated;
  }
}
