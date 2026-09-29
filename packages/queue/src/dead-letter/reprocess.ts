// EXEC-QUEUE-025: Dead-Letter Reprocessing
// Canonical Execution Graph Module Contract (["`reprocessDeadLetter(id) -> Promise<JobRef>`"])
export const capabilityContract = Object.freeze({
  nodeId: 'EXEC-QUEUE-025',
  name: 'Dead-Letter Reprocessing',
  contract: '["`reprocessDeadLetter(id) -> Promise<JobRef>`"]',
});
export type capabilityContractType = typeof capabilityContract;
