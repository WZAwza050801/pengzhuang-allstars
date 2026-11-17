const snapshots = new WeakSet<object>();

/** Canonical finite JSON only: no getters/classes/undefined/cycles or unbounded nesting. */
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  function visit(item: unknown, depth: number): string {
    if (depth > 64) throw new Error('JSON nesting limit');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('Nonfinite JSON number');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') throw new Error('Unsupported JSON value');
    if (seen.has(item)) throw new Error('Cyclic JSON value');
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))
      throw new Error('JSON object required');
    seen.add(item);
    let result: string;
    if (Array.isArray(item))
      result = `[${Array.from({ length: item.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !('value' in descriptor))
          throw new Error('JSON array values required; accessors are not allowed');
        return visit(descriptor.value, depth + 1);
      }).join(',')}]`;
    else {
      const descriptors = Object.getOwnPropertyDescriptors(item);
      result = `{${Object.keys(descriptors)
        .filter((key) => descriptors[key].enumerable)
        .sort()
        .map((key) => {
          const entry = descriptors[key];
          if (!('value' in entry)) throw new Error('JSON accessors are not allowed');
          return `${JSON.stringify(key)}:${visit(entry.value, depth + 1)}`;
        })
        .join(',')}}`;
    }
    seen.delete(item);
    return result;
  }
  return visit(value, 0);
}
export function freezeSnapshot<T>(source: T): T {
  if (source !== null && typeof source === 'object' && snapshots.has(source)) return source;
  const value: T = JSON.parse(canonicalJson(source));
  function freeze(item: unknown) {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  }
  freeze(value);
  if (value !== null && typeof value === 'object') snapshots.add(value);
  return value;
}
