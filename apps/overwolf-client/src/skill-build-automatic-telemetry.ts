import {
  createEmptySkillLevels,
  SkillLevel,
  SkillLevels,
  SkillSlot,
} from './skill-build-client';

const SKILL_SLOTS = [1, 2, 3, 4] as const;
const MAX_TRAVERSAL_DEPTH = 10;

const ABILITY_STATE_KEYS = new Set([
  'mvecabilityupgradestate',
  'abilityupgradestate',
  'abilityupgrades',
  'abilitystates',
  'skillupgradestate',
  'skillupgrades',
  'skillstates',
]);

const ABILITY_ID_KEYS = new Set([
  'abilityid',
  'itemid',
  'mitemid',
  'id',
]);

const DIRECT_LEVEL_KEYS = new Set([
  'abilitylevel',
  'skilllevel',
  'upgradelevel',
  'currentlevel',
  'level',
  'rank',
  'upgrades',
  'upgradecount',
]);

const UPGRADE_TIER_KEYS = new Set([
  'upgradetier',
  'abilityupgradetier',
  'skillupgradetier',
]);

const PACKED_UPGRADE_KEYS = new Set([
  'mnupgradeinfo',
  'upgradeinfo',
  'abilityupgradeinfo',
]);

const SLOT_KEYS = new Set([
  'abilityslot',
  'skillslot',
  'slot',
  'abilityindex',
  'skillindex',
]);

const STEAM_ID_KEYS = new Set([
  'steamid',
  'steamid64',
  'playersteamid',
]);

export type AutomaticSkillTelemetryConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AutomaticSkillTelemetryContext {
  abilityIdsBySlot: Readonly<Record<SkillSlot, number>>;
  localSteamId?: string;
  eventKey?: string;
}

export interface AutomaticSkillTelemetryResult {
  levels: SkillLevels;
  observedSlots: SkillSlot[];
  complete: boolean;
  confidence: AutomaticSkillTelemetryConfidence;
  evidence: string[];
}

interface Candidate {
  levels: SkillLevels;
  observedSlots: Set<SkillSlot>;
  confidence: AutomaticSkillTelemetryConfidence;
  evidence: string;
  score: number;
}

interface ScopedRoot {
  value: unknown;
  allowIndexFallback: boolean;
  label: string;
}

interface ParsedLevel {
  level: SkillLevel;
  evidence: string;
}

export function extractAutomaticSkillTelemetry(
  value: unknown,
  context: AutomaticSkillTelemetryContext,
): AutomaticSkillTelemetryResult | undefined {
  const parsed = parseJsonValue(value);
  if (!isRecord(parsed)) {
    return undefined;
  }

  const abilitySlotById = createAbilitySlotById(context.abilityIdsBySlot);
  const scopedRoots = collectScopedRoots(parsed, context);
  const candidates: Candidate[] = [];

  for (const scopedRoot of scopedRoots) {
    collectCandidates(
      scopedRoot.value,
      abilitySlotById,
      scopedRoot.allowIndexFallback,
      scopedRoot.label,
      candidates,
    );
  }

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort(compareCandidates);
  const best = candidates[0];

  return {
    levels: { ...best.levels },
    observedSlots: [...best.observedSlots].sort((left, right) => left - right),
    complete: best.observedSlots.size === SKILL_SLOTS.length,
    confidence: best.confidence,
    evidence: uniqueStrings(
      candidates
        .filter((candidate) => candidate.score === best.score)
        .map((candidate) => candidate.evidence),
    ),
  };
}

export function decodePackedAbilityLevel(value: unknown): SkillLevel | undefined {
  const parsed = toInteger(value);
  if (parsed === undefined) {
    return undefined;
  }

  const unsigned = parsed >>> 0;
  const upgradeMask = (unsigned >>> 16) & 0xffff;
  if ((upgradeMask & (upgradeMask + 1)) !== 0) {
    return undefined;
  }

  const level = Math.log2(upgradeMask + 1);
  if (!Number.isSafeInteger(level) || level < 0 || level > 4) {
    return undefined;
  }

  return level as SkillLevel;
}

export function mergeObservedSkillLevels(
  current: SkillLevels,
  observation: AutomaticSkillTelemetryResult,
): SkillLevels {
  const merged = { ...current };
  for (const skillSlot of observation.observedSlots) {
    merged[skillSlot] = Math.max(
      current[skillSlot],
      observation.levels[skillSlot],
    ) as SkillLevel;
  }
  return merged;
}

function collectScopedRoots(
  root: Record<string, unknown>,
  context: AutomaticSkillTelemetryContext,
): ScopedRoot[] {
  const roots: ScopedRoot[] = [
    {
      value: root,
      allowIndexFallback: false,
      label: context.eventKey ?? 'root',
    },
  ];
  const localSteamId = normalizeSteamId(context.localSteamId);
  const localSlot = localSteamId ? findRosterSlot(root, localSteamId) : undefined;
  const eventSlot = readSlotSuffix(context.eventKey);
  const eventIsLocal =
    localSlot !== undefined && eventSlot !== undefined && eventSlot === localSlot;

  if (eventIsLocal || (localSteamId && containsSteamId(root, localSteamId))) {
    roots.push({
      value: root,
      allowIndexFallback: true,
      label: context.eventKey ?? 'local-event',
    });
  }

  collectLocalRoots(root, localSteamId, localSlot, roots, 0);

  const exactVectors = findExactAbilityStateVectors(root);
  if (exactVectors.length === 1) {
    roots.push({
      value: exactVectors[0],
      allowIndexFallback: true,
      label: 'single-ability-state-vector',
    });
  }

  return deduplicateScopedRoots(roots);
}

function collectLocalRoots(
  value: unknown,
  localSteamId: string | undefined,
  localSlot: number | undefined,
  roots: ScopedRoot[],
  depth: number,
): void {
  if (depth > MAX_TRAVERSAL_DEPTH) {
    return;
  }

  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    for (const nested of parsed) {
      collectLocalRoots(nested, localSteamId, localSlot, roots, depth + 1);
    }
    return;
  }
  if (!isRecord(parsed)) {
    return;
  }

  if (localSteamId && containsDirectSteamId(parsed, localSteamId)) {
    roots.push({
      value: parsed,
      allowIndexFallback: true,
      label: 'steam-id-match',
    });
  }

  for (const [key, nested] of Object.entries(parsed)) {
    const suffix = readSlotSuffix(key);
    if (localSlot !== undefined && suffix === localSlot) {
      roots.push({
        value: nested,
        allowIndexFallback: true,
        label: key,
      });
    }
    collectLocalRoots(nested, localSteamId, localSlot, roots, depth + 1);
  }
}

function collectCandidates(
  value: unknown,
  abilitySlotById: ReadonlyMap<number, SkillSlot>,
  allowIndexFallback: boolean,
  sourceLabel: string,
  output: Candidate[],
  depth = 0,
  visited = new WeakSet<object>(),
): void {
  if (depth > MAX_TRAVERSAL_DEPTH) {
    return;
  }

  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    if (visited.has(parsed)) {
      return;
    }
    visited.add(parsed);

    const vectorCandidate = parseEntryVector(
      parsed,
      abilitySlotById,
      false,
      allowIndexFallback,
      sourceLabel,
    );
    if (vectorCandidate) {
      output.push(vectorCandidate);
    }

    const itemCandidate = parseAbilityItems(parsed, abilitySlotById, sourceLabel);
    if (itemCandidate) {
      output.push(itemCandidate);
    }

    for (const nested of parsed) {
      collectCandidates(
        nested,
        abilitySlotById,
        allowIndexFallback,
        sourceLabel,
        output,
        depth + 1,
        visited,
      );
    }
    return;
  }

  if (!isRecord(parsed) || visited.has(parsed)) {
    return;
  }
  visited.add(parsed);

  const singleEntry = parseEntryVector(
    [parsed],
    abilitySlotById,
    false,
    false,
    sourceLabel,
  );
  if (singleEntry) {
    output.push(singleEntry);
  }

  for (const [key, nested] of Object.entries(parsed)) {
    const normalizedKey = normalizeKey(key);
    const entries = toEntryArray(nested);

    if (entries && ABILITY_STATE_KEYS.has(normalizedKey)) {
      const candidate = parseEntryVector(
        entries,
        abilitySlotById,
        true,
        allowIndexFallback,
        key,
      );
      if (candidate) {
        output.push(candidate);
      }
    }

    if (entries && normalizedKey.includes('items')) {
      const candidate = parseAbilityItems(entries, abilitySlotById, key);
      if (candidate) {
        output.push(candidate);
      }
    }

    collectCandidates(
      nested,
      abilitySlotById,
      allowIndexFallback,
      key,
      output,
      depth + 1,
      visited,
    );
  }
}

function parseEntryVector(
  entries: unknown[],
  abilitySlotById: ReadonlyMap<number, SkillSlot>,
  isExplicitAbilityStateVector: boolean,
  allowIndexFallback: boolean,
  sourceLabel: string,
): Candidate | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const levels = createEmptySkillLevels();
  const observedSlots = new Set<SkillSlot>();
  let confidence: AutomaticSkillTelemetryConfidence = 'LOW';
  let evidence = '';
  let mappingScore = 0;

  for (const [index, rawEntry] of entries.entries()) {
    const entry = parseJsonValue(rawEntry);
    if (!isRecord(entry)) {
      continue;
    }

    const parsedLevel = readEntryLevel(entry);
    if (!parsedLevel) {
      continue;
    }

    const abilityId = readEntryAbilityId(entry);
    const slotById = abilityId === undefined
      ? undefined
      : abilitySlotById.get(normalizeUint32(abilityId));
    const explicitSlot = readEntrySlot(entry);
    const indexSlot =
      isExplicitAbilityStateVector &&
      allowIndexFallback &&
      entries.length === SKILL_SLOTS.length
        ? ((index + 1) as SkillSlot)
        : undefined;
    const skillSlot = slotById ?? explicitSlot ?? indexSlot;
    if (!skillSlot) {
      continue;
    }

    levels[skillSlot] = Math.max(levels[skillSlot], parsedLevel.level) as SkillLevel;
    observedSlots.add(skillSlot);

    if (slotById) {
      confidence = 'HIGH';
      mappingScore = Math.max(mappingScore, 300);
      evidence = `${parsedLevel.evidence}:ability-id:${sourceLabel}`;
    } else if (explicitSlot) {
      if (confidence !== 'HIGH') {
        confidence = 'HIGH';
      }
      mappingScore = Math.max(mappingScore, 260);
      evidence = `${parsedLevel.evidence}:explicit-slot:${sourceLabel}`;
    } else if (indexSlot && confidence === 'LOW') {
      confidence = 'MEDIUM';
      mappingScore = Math.max(mappingScore, 180);
      evidence = `${parsedLevel.evidence}:vector-index:${sourceLabel}`;
    }
  }

  if (observedSlots.size === 0) {
    return undefined;
  }

  return {
    levels,
    observedSlots,
    confidence,
    evidence,
    score: mappingScore + observedSlots.size * 10 + getTotalLevel(levels),
  };
}

function parseAbilityItems(
  entries: unknown[],
  abilitySlotById: ReadonlyMap<number, SkillSlot>,
  sourceLabel: string,
): Candidate | undefined {
  const counts = createEmptySkillLevels();
  const explicitLevels = createEmptySkillLevels();
  const observedSlots = new Set<SkillSlot>();

  for (const rawEntry of entries) {
    const entry = parseJsonValue(rawEntry);
    if (!isRecord(entry)) {
      continue;
    }

    const abilityId = readEntryAbilityId(entry);
    if (abilityId === undefined) {
      continue;
    }

    const skillSlot = abilitySlotById.get(normalizeUint32(abilityId));
    if (!skillSlot) {
      continue;
    }

    counts[skillSlot] = Math.min(4, counts[skillSlot] + 1) as SkillLevel;
    observedSlots.add(skillSlot);

    const parsedLevel = readEntryLevel(entry);
    if (parsedLevel) {
      explicitLevels[skillSlot] = Math.max(
        explicitLevels[skillSlot],
        parsedLevel.level,
      ) as SkillLevel;
    }
  }

  if (observedSlots.size === 0) {
    return undefined;
  }

  const levels = createEmptySkillLevels();
  let hasExplicitLevel = false;
  for (const skillSlot of observedSlots) {
    levels[skillSlot] = Math.max(
      counts[skillSlot],
      explicitLevels[skillSlot],
    ) as SkillLevel;
    hasExplicitLevel = hasExplicitLevel || explicitLevels[skillSlot] > 0;
  }

  return {
    levels,
    observedSlots,
    confidence: hasExplicitLevel ? 'HIGH' : 'LOW',
    evidence: hasExplicitLevel
      ? `ability-item-level:${sourceLabel}`
      : `ability-item-count:${sourceLabel}`,
    score: (hasExplicitLevel ? 280 : 80) + observedSlots.size * 10 + getTotalLevel(levels),
  };
}

function readEntryLevel(entry: Record<string, unknown>): ParsedLevel | undefined {
  for (const [key, value] of Object.entries(entry)) {
    const normalizedKey = normalizeKey(key);
    if (PACKED_UPGRADE_KEYS.has(normalizedKey)) {
      const level = decodePackedAbilityLevel(value);
      if (level !== undefined) {
        return { level, evidence: 'packed-upgrade-info' };
      }
    }
  }

  for (const [key, value] of Object.entries(entry)) {
    const normalizedKey = normalizeKey(key);
    if (DIRECT_LEVEL_KEYS.has(normalizedKey)) {
      const level = toSkillLevel(value);
      if (level !== undefined) {
        return { level, evidence: `direct-level:${key}` };
      }
    }
  }

  for (const [key, value] of Object.entries(entry)) {
    const normalizedKey = normalizeKey(key);
    if (UPGRADE_TIER_KEYS.has(normalizedKey)) {
      const tier = toInteger(value);
      if (tier !== undefined && tier >= 0 && tier <= 3) {
        return {
          level: (tier + 1) as SkillLevel,
          evidence: `upgrade-tier:${key}`,
        };
      }
    }
  }

  return undefined;
}

function readEntryAbilityId(entry: Record<string, unknown>): number | undefined {
  for (const [key, value] of Object.entries(entry)) {
    if (!ABILITY_ID_KEYS.has(normalizeKey(key))) {
      continue;
    }
    const abilityId = toInteger(value);
    if (abilityId !== undefined) {
      return abilityId;
    }
  }
  return undefined;
}

function readEntrySlot(entry: Record<string, unknown>): SkillSlot | undefined {
  for (const [key, value] of Object.entries(entry)) {
    const normalizedKey = normalizeKey(key);
    if (!SLOT_KEYS.has(normalizedKey)) {
      continue;
    }

    const parsed = toInteger(value);
    if (parsed === undefined) {
      continue;
    }
    if (parsed >= 1 && parsed <= 4) {
      return parsed as SkillSlot;
    }
    if (normalizedKey.includes('index') && parsed >= 0 && parsed <= 3) {
      return (parsed + 1) as SkillSlot;
    }
  }
  return undefined;
}

function createAbilitySlotById(
  abilityIdsBySlot: Readonly<Record<SkillSlot, number>>,
): Map<number, SkillSlot> {
  return new Map<number, SkillSlot>(
    SKILL_SLOTS.map((skillSlot) => [
      normalizeUint32(abilityIdsBySlot[skillSlot]),
      skillSlot,
    ]),
  );
}

function findRosterSlot(root: unknown, localSteamId: string): number | undefined {
  let found: number | undefined;

  traverse(root, (value, pathKey) => {
    if (found !== undefined || !isRecord(value)) {
      return;
    }
    const slot = readSlotSuffix(pathKey);
    if (slot === undefined || !containsSteamId(value, localSteamId)) {
      return;
    }
    found = slot;
  });

  return found;
}

function findExactAbilityStateVectors(root: unknown): unknown[] {
  const result: unknown[] = [];
  traverse(root, (value, pathKey) => {
    if (ABILITY_STATE_KEYS.has(normalizeKey(pathKey)) && toEntryArray(value)) {
      result.push(value);
    }
  });
  return result;
}

function traverse(
  value: unknown,
  visitor: (value: unknown, pathKey: string) => void,
  pathKey = '',
  depth = 0,
  visited = new WeakSet<object>(),
): void {
  if (depth > MAX_TRAVERSAL_DEPTH) {
    return;
  }

  const parsed = parseJsonValue(value);
  visitor(parsed, pathKey);

  if (Array.isArray(parsed)) {
    if (visited.has(parsed)) {
      return;
    }
    visited.add(parsed);
    for (const nested of parsed) {
      traverse(nested, visitor, pathKey, depth + 1, visited);
    }
    return;
  }

  if (!isRecord(parsed) || visited.has(parsed)) {
    return;
  }
  visited.add(parsed);
  for (const [key, nested] of Object.entries(parsed)) {
    traverse(nested, visitor, key, depth + 1, visited);
  }
}

function containsSteamId(value: unknown, steamId: string): boolean {
  let found = false;
  traverse(value, (nested) => {
    if (found || !isRecord(nested)) {
      return;
    }
    found = containsDirectSteamId(nested, steamId);
  });
  return found;
}

function containsDirectSteamId(
  value: Record<string, unknown>,
  steamId: string,
): boolean {
  for (const [key, nested] of Object.entries(value)) {
    if (!STEAM_ID_KEYS.has(normalizeKey(key))) {
      continue;
    }
    if (normalizeSteamId(nested) === steamId) {
      return true;
    }
  }
  return false;
}

function toEntryArray(value: unknown): unknown[] | undefined {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }

  const numericEntries = Object.entries(parsed)
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, nested]) => nested);
  return numericEntries.length > 0 ? numericEntries : undefined;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (
    !normalized.startsWith('{') &&
    !normalized.startsWith('[') &&
    !normalized.startsWith('"')
  ) {
    return value;
  }

  try {
    return JSON.parse(normalized);
  } catch {
    return value;
  }
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return right.score - left.score ||
    right.observedSlots.size - left.observedSlots.size ||
    getTotalLevel(right.levels) - getTotalLevel(left.levels);
}

function getTotalLevel(levels: SkillLevels): number {
  return SKILL_SLOTS.reduce((total, skillSlot) => total + levels[skillSlot], 0);
}

function toSkillLevel(value: unknown): SkillLevel | undefined {
  const parsed = toInteger(value);
  return parsed !== undefined && parsed >= 0 && parsed <= 4
    ? (parsed as SkillLevel)
    : undefined;
}

function toInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function normalizeUint32(value: number): number {
  return value >>> 0;
}

function normalizeSteamId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function readSlotSuffix(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/[_-](\d+)$/);
  if (!match) {
    return undefined;
  }
  const slot = Number(match[1]);
  return Number.isSafeInteger(slot) && slot >= 0 ? slot : undefined;
}

function deduplicateScopedRoots(roots: ScopedRoot[]): ScopedRoot[] {
  const objectRoots = new WeakSet<object>();
  const primitiveKeys = new Set<string>();
  const result: ScopedRoot[] = [];

  for (const root of roots) {
    const parsed = parseJsonValue(root.value);
    if (typeof parsed === 'object' && parsed !== null) {
      if (objectRoots.has(parsed)) {
        continue;
      }
      objectRoots.add(parsed);
    } else {
      const key = `${typeof parsed}:${String(parsed)}:${root.allowIndexFallback}`;
      if (primitiveKeys.has(key)) {
        continue;
      }
      primitiveKeys.add(key);
    }
    result.push({ ...root, value: parsed });
  }

  return result;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
