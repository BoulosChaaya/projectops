// EXEC-QUEUE-030: Delayed Execution
// Canonical Execution Graph Module Contract (["`scheduleAt(job, runAt) -> Promise<JobRef>`"])
export const capabilityContract = Object.freeze({
  nodeId: 'EXEC-QUEUE-030',
  name: 'Delayed Execution',
  contract: '["`scheduleAt(job, runAt) -> Promise<JobRef>`"]',
});
export type capabilityContractType = typeof capabilityContract;
