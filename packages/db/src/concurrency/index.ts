// EXEC-DB-034: Concurrent Write Conflict Handling
import { OptimisticLock } from './optimistic-lock.ts';
import { PessimisticLock } from './pessimistic-lock.ts';
import { executeWithDeadlockRecovery } from './deadlock-recovery.ts';

export const ConcurrentWritePolicy = Object.freeze({
  OptimisticLock,
  PessimisticLock,
  executeWithDeadlockRecovery,
});
