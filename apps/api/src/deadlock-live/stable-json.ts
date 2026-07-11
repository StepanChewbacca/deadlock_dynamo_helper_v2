import { createHash } from 'node:crypto';

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
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}
