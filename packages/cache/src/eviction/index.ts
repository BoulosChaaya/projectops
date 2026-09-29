// EXEC-CACHE-016: Cache Memory Bound & LRU Eviction
export class BoundedCacheEvictor<T = string> {
  private readonly maxEntries: number;
  private readonly map = new Map<string, T>();

  constructor(maxEntries = 1000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('maxEntries must be a positive integer.');
    }
    this.maxEntries = maxEntries;
  }

  public get(key: string): T | undefined {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key)!;
    // Refresh LRU order
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  public set(key: string, value: T): string | undefined {
    let evictedKey: string | undefined;
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
        evictedKey = oldestKey;
      }
    }
    this.map.set(key, value);
    return evictedKey;
  }

  public delete(key: string): boolean {
    return this.map.delete(key);
  }

  public size(): number {
    return this.map.size;
  }
}
