// EXEC-CACHE-003: Cache Miss Handling
import { withStampedeProtection, type SingleFlightCoalescer } from '../stampede/index.ts';

export async function handleCacheMiss<T>(
  key: string,
  originLoader: () => Promise<T | null>,
  onPopulate: (value: T | null) => Promise<void>,
  coalescer?: SingleFlightCoalescer
): Promise<T | null> {
  return await withStampedeProtection(
    key,
    async () => {
      const loaded = await originLoader();
      await onPopulate(loaded);
      return loaded;
    },
    coalescer
  );
}
