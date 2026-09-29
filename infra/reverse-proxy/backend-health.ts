// EXEC-OPS-009: Unhealthy Instance Exclusion
export const capabilityContract = Object.freeze({
  nodeId: 'EXEC-OPS-009',
  name: 'Unhealthy Instance Exclusion',
  contract: '["`eligibleBackends(health) -> Backend[]`"]',
});
