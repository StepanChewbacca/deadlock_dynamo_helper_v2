import { createHash, type Hash } from 'node:crypto';

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const properties = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`);
    return `{${properties.join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

export function sha256StableJson(value: unknown): string {
  const hash = createHash('sha256');
  updateStableJsonHash(hash, value);
  return hash.digest('hex');
}

export function updateStableJsonHash(hash: Hash, value: unknown): void {
  if (Array.isArray(value)) {
    hash.update('[');
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) {
        hash.update(',');
      }
      updateStableJsonHash(hash, value[index]);
    }
    hash.update(']');
    return;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    hash.update('{');
    for (let index = 0; index < keys.length; index += 1) {
      if (index > 0) {
        hash.update(',');
      }
      const key = keys[index];
      hash.update(JSON.stringify(key));
      hash.update(':');
      updateStableJsonHash(hash, record[key]);
    }
    hash.update('}');
    return;
  }

  hash.update(JSON.stringify(value) ?? 'null');
}
