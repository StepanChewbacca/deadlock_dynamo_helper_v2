from pathlib import Path
import re


def replace_once(content: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, content, count=1, flags=re.MULTILINE | re.DOTALL)
    if count != 1:
        raise RuntimeError(f'{label}: expected one replacement, got {count}')
    return updated


collector_path = Path('apps/api/src/deadlock-live/match-timeline-collector.service.ts')
collector = collector_path.read_text()
collector = replace_once(
    collector,
    r"passed:\s*session\.status\.eventCount > 0 &&\s*session\.writeErrorCount === 0 &&\s*session\.status\.state !== 'FAILED',",
    "passed:\n        session.ended &&\n        session.status.eventCount > 0 &&\n        session.writeErrorCount === 0 &&\n        session.status.state === 'COMPLETE',",
    'collector audit completeness',
)
collector_path.write_text(collector)


dataset_path = Path('apps/api/src/deadlock-live/recommendation-decision-dataset-v5.service.ts')
dataset = dataset_path.read_text()

dataset = replace_once(
    dataset,
    r"const previousActions: string\[\] = \[\];\s*for \(let index = 0; index < group\.length; index \+= 1\) \{\s*const row = group\[index\];",
    "let previousActions: string[] = [];\n      for (let index = 0; index < group.length; index += 1) {\n        const row = group[index];\n        const rowPreviousActions = mergeActionHistories(\n          previousActions,\n          row.previousActionKeys,\n        );",
    'trajectory source history',
)

dataset = dataset.replace(
    '          previousActions,\n          timeline,',
    '          previousActions: rowPreviousActions,\n          timeline,',
    1,
)
if '          previousActions: rowPreviousActions,\n          timeline,' not in dataset:
    raise RuntimeError('trajectory enrich argument was not replaced')

dataset = replace_once(
    dataset,
    r"const action = row\.observedLabel\.exactActionKey;\s*if \(action\) \{\s*previousActions\.push\(action\);\s*\}",
    "previousActions = mergeActionHistories(\n          rowPreviousActions,\n          row.observedLabel.observedActionKeys,\n        );",
    'trajectory observed actions',
)

helper = """
function mergeActionHistories(
  accumulated: readonly string[],
  additional: readonly string[],
): string[] {
  const normalizedAdditional = additional.filter((actionKey) => actionKey.length > 0);
  if (normalizedAdditional.length === 0) {
    return [...accumulated];
  }
  const maximumOverlap = Math.min(accumulated.length, normalizedAdditional.length);
  for (let overlap = maximumOverlap; overlap > 0; overlap -= 1) {
    const accumulatedSuffix = accumulated.slice(accumulated.length - overlap);
    const additionalPrefix = normalizedAdditional.slice(0, overlap);
    if (
      accumulatedSuffix.every(
        (actionKey, index) => actionKey === additionalPrefix[index],
      )
    ) {
      return [...accumulated, ...normalizedAdditional.slice(overlap)];
    }
  }
  return [...accumulated, ...normalizedAdditional];
}

"""
marker = 'function enrich(input: {'
if marker not in dataset:
    raise RuntimeError('enrich marker was not found')
dataset = dataset.replace(marker, helper + marker, 1)

dataset = replace_once(
    dataset,
    r"input\.timeline\.objectives,\s*liveTeam\(input\.row\.teamId\),\s*\),",
    "input.timeline.objectives,\n        liveTeam(input.row.teamId),\n        input.snapshotStalenessS,\n      ),",
    'horizon staleness argument',
)

start = dataset.index('function horizonOutcome(')
end = dataset.index('function snapshotFeature(', start)
horizon_function = """function horizonOutcome(
  decisionTime: number,
  seconds: number,
  baseline: MatchTimelinePlayerSnapshot | undefined,
  snapshots: readonly MatchTimelinePlayerSnapshot[],
  objectives: readonly MatchTimelineObjectiveEvent[],
  teamId: number | undefined,
  snapshotStalenessS: number,
): Record<string, unknown> {
  const upper = decisionTime + seconds;
  const target = latestInWindow(snapshots, decisionTime, upper);
  const baselineStalenessS = baseline
    ? Math.max(0, decisionTime - baseline.gameTimeS)
    : undefined;
  const targetStalenessS = target
    ? Math.max(0, upper - target.gameTimeS)
    : undefined;
  const baselineFresh =
    baseline !== undefined &&
    baselineStalenessS !== undefined &&
    baselineStalenessS <= snapshotStalenessS;
  const targetFresh =
    target !== undefined &&
    targetStalenessS !== undefined &&
    targetStalenessS <= snapshotStalenessS;
  const events = objectives.filter(
    (event) => event.gameTimeS > decisionTime && event.gameTimeS <= upper,
  );
  if (!baselineFresh || !targetFresh || !baseline || !target) {
    return {
      available: false,
      horizonS: seconds,
      lowerBoundGameTimeS: decisionTime,
      upperBoundGameTimeS: upper,
      baselineAvailable: Boolean(baseline),
      baselineFresh,
      baselineStalenessS,
      targetAvailable: Boolean(target),
      targetFresh,
      targetStalenessS,
      objectiveEventCount: events.length,
      unavailableReason: !baseline
        ? 'MISSING_SNAPSHOT_AT_OR_BEFORE_DECISION'
        : !baselineFresh
          ? 'STALE_SNAPSHOT_AT_DECISION'
          : !target
            ? 'MISSING_SNAPSHOT_IN_HORIZON_WINDOW'
            : 'STALE_SNAPSHOT_AT_HORIZON',
    };
  }
  const ownObjectiveLossCount =
    teamId === undefined
      ? undefined
      : events.filter((event) => event.teamId === teamId).length;
  const enemyObjectiveLossCount =
    teamId === undefined
      ? undefined
      : events.filter(
          (event) => event.teamId !== undefined && event.teamId !== teamId,
        ).length;
  return {
    available: true,
    horizonS: seconds,
    lowerBoundGameTimeS: decisionTime,
    upperBoundGameTimeS: upper,
    baselineSnapshotGameTimeS: baseline.gameTimeS,
    baselineStalenessS,
    targetSnapshotGameTimeS: target.gameTimeS,
    targetStalenessS,
    killsDelta: target.kills - baseline.kills,
    deathsDelta: target.deaths - baseline.deaths,
    assistsDelta: target.assists - baseline.assists,
    netWorthDelta: target.netWorth - baseline.netWorth,
    heroDamageDelta: target.heroDamage - baseline.heroDamage,
    killParticipationDelta:
      target.kills + target.assists - baseline.kills - baseline.assists,
    survived: target.deaths === baseline.deaths,
    objectiveEventCount: events.length,
    ownObjectiveLossCount,
    enemyObjectiveLossCount,
  };
}

"""
dataset = dataset[:start] + horizon_function + dataset[end:]

dataset = replace_once(
    dataset,
    r"const spikeCosts = progress\s*\.map\(\(entry\) => numeric\(entry\.missingCost\)\)\s*\.filter\(\(value\) => value > 0\);",
    "const spikeCosts = progress\n    .filter((entry) => entry.complete !== true)\n    .map((entry) => numeric(entry.missingCost))\n    .filter((value) => value > 0);",
    'incomplete power spike costs',
)
dataset_path.write_text(dataset)


test_path = Path('apps/api/test/recommendation-decision-dataset-v5.spec.ts')
test = test_path.read_text()
test = test.replace(
    "createRow({ decisionId: 'decision-1', gameTimeS: 100, inventoryStateKey: 'EMPTY', exactActionKey: 'BUY:1', candidateActionKeys: ['BUY:1', 'BUY:2'] })",
    "createRow({ decisionId: 'decision-1', gameTimeS: 100, inventoryStateKey: 'EMPTY', exactActionKey: 'BUY:1', candidateActionKeys: ['BUY:1', 'BUY:2'], previousActionKeys: ['BUY:9', 'SELL:9'] })",
    1,
)
test = test.replace(
    'expect(first.trajectory.fullPreviousActionKeys).toEqual([]);',
    "expect(first.trajectory.fullPreviousActionKeys).toEqual(['BUY:9', 'SELL:9']);",
    1,
)
test = test.replace(
    "    expect(first.trajectory.nextObservedActionKey).toBe('BUY:2');",
    """    expect(first.trajectory.nextObservedActionKey).toBe('BUY:2');
    const second = outputRows.find((row) => row.decisionId === 'decision-2') as any;
    expect(second.trajectory.fullPreviousActionKeys).toEqual([
      'BUY:9',
      'SELL:9',
      'BUY:1',
    ]);""",
    1,
)
test = test.replace(
    'function createRow(input: { decisionId: string; gameTimeS: number; inventoryStateKey: string; exactActionKey: string; candidateActionKeys: string[] }): RecommendationDecisionDatasetV4Row {',
    'function createRow(input: { decisionId: string; gameTimeS: number; inventoryStateKey: string; exactActionKey: string; candidateActionKeys: string[]; previousActionKeys?: string[] }): RecommendationDecisionDatasetV4Row {',
    1,
)
test = test.replace(
    '    previousActionKeys: [],',
    '    previousActionKeys: input.previousActionKeys ?? [],',
    1,
)
if "previousActionKeys: input.previousActionKeys ?? []" not in test:
    raise RuntimeError('test row history was not updated')
test_path.write_text(test)
