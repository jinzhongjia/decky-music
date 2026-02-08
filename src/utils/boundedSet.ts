/**
 * 有界 Set 工具，避免全局缓存无限增长。
 */

export const addToBoundedSet = (
  cache: Set<string>,
  value: string,
  maxSize: number
): void => {
  if (cache.has(value)) {
    return;
  }

  cache.add(value);

  while (cache.size > maxSize) {
    const oldest = cache.values().next();
    if (oldest.done) {
      break;
    }
    cache.delete(oldest.value);
  }
};
