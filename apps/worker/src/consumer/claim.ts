// EXEC-QUEUE-009: Job Dequeue & Lock
// Canonical Execution Graph Module Contract (["`claimJob() -> Promise<LockedJob | null>`"])
export const capabilityContract = Object.freeze({
  nodeId: 'EXEC-QUEUE-009',
  name: 'Job Dequeue & Lock',
  contract: '["`claimJob() -> Promise<LockedJob | null>`"]',
});
export type capabilityContractType = typeof capabilityContract;
