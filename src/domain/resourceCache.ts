export interface AsyncResourceCache<T> {
  get(key: string, loader: () => Promise<T>): Promise<T>;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  size(): number;
}

export function createAsyncResourceCache<T>(): AsyncResourceCache<T> {
  const values = new Map<string, Promise<T>>();
  return {
    get(key, loader) {
      const existing = values.get(key);
      if (existing) return existing;
      const pending = loader().catch((error) => {
        values.delete(key);
        throw error;
      });
      values.set(key, pending);
      return pending;
    },
    has: (key) => values.has(key),
    delete: (key) => { values.delete(key); },
    clear: () => values.clear(),
    size: () => values.size,
  };
}
