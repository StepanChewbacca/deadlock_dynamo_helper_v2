from pathlib import Path

service_path = Path('apps/api/src/deadlock-live/recommendation-decision-dataset-v5.service.ts')
service = service_path.read_text()
service = service.replace(
    'export const RECOMMENDATION_DECISION_DATASET_V5_SCHEMA_VERSION = 1;',
    'export const RECOMMENDATION_DECISION_DATASET_V5_SCHEMA_VERSION = 2;',
    1,
)
service = service.replace(
    "  'RECOMMENDATION_DECISION_DATASET_V5_1' as const;",
    "  'RECOMMENDATION_DECISION_DATASET_V5_2' as const;",
    1,
)
old_call = """        input.timeline.objectives,
        liveTeam(input.row.teamId),
      ),"""
new_call = """        input.timeline.objectives,
        liveTeam(input.row.teamId),
        input.snapshotStalenessS,
      ),"""
if old_call not in service:
    raise SystemExit('horizon call block not found')
service = service.replace(old_call, new_call, 1)

start = service.index('function horizonOutcome(')
end = service.index('function snapshotFeature(', start)
replacement = """function horizonOutcome(
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
service = service[:start] + replacement + service[end:]
service_path.write_text(service)

test_path = Path('apps/api/test/recommendation-decision-dataset-v5.spec.ts')
test = test_path.read_text()
test = test.replace(
    '      rowsWithComplete3mOutcomeCount: 2,',
    '      rowsWithComplete3mOutcomeCount: 1,',
    1,
)
old_expect = """      netWorthDelta: 1700,
      objectiveEventCount: 1,
    });"""
new_expect = """      netWorthDelta: 1700,
      objectiveEventCount: 1,
      baselineStalenessS: 5,
      targetStalenessS: 5,
      ownObjectiveLossCount: 0,
      enemyObjectiveLossCount: 1,
    });"""
if old_expect not in test:
    raise SystemExit('primary horizon expectation not found')
test = test.replace(old_expect, new_expect, 1)

marker = """  it('restores a completed build without duplicating rows', async () => {"""
stale_test = """  it('rejects a stale horizon snapshot instead of treating partial coverage as exact', async () => {
    const rows = [createRows()[0]];
    const sourceSha256 = await writeSourceArtifacts(rows, sourceDirectory);
    await writeTimelineArtifacts(timelineDirectory, [
      createSnapshot(95, 1, 0, 1, 1000),
      createSnapshot(150, 2, 0, 2, 1800),
    ]);
    const service = new RecommendationDecisionDatasetV5Service();
    await service.onModuleInit();
    await service.start({
      expectedSourceSha256: sourceSha256,
      partitionCount: 2,
      snapshotStalenessS: 60,
    });
    await service.waitForIdle();

    const [row] = await readNdjson(join(outputDirectory, 'dataset.ndjson'));
    expect(row.shortHorizonOutcomes.windows['3m']).toMatchObject({
      available: false,
      baselineFresh: true,
      targetAvailable: true,
      targetFresh: false,
      targetStalenessS: 130,
      unavailableReason: 'STALE_SNAPSHOT_AT_HORIZON',
    });
    expect(row.trainingEligibility.shortHorizon3m).toBe(false);
  });

"""
if marker not in test:
    raise SystemExit('test insertion marker not found')
test = test.replace(marker, stale_test + marker, 1)

old_helper = """async function writeTimelineArtifacts(root: string): Promise<void> {
  const directory = join(root, '100');
  await mkdir(directory, { recursive: true });
  const snapshots: MatchTimelinePlayerSnapshot[] = [
    createSnapshot(95, 1, 0, 1, 1000),
    createSnapshot(275, 2, 1, 3, 2700),
    createSnapshot(395, 3, 1, 4, 3900),
    createSnapshot(695, 4, 2, 5, 7000),
  ];"""
new_helper = """async function writeTimelineArtifacts(
  root: string,
  snapshots: MatchTimelinePlayerSnapshot[] = [
    createSnapshot(95, 1, 0, 1, 1000),
    createSnapshot(275, 2, 1, 3, 2700),
    createSnapshot(395, 3, 1, 4, 3900),
    createSnapshot(695, 4, 2, 5, 7000),
  ],
): Promise<void> {
  const directory = join(root, '100');
  await mkdir(directory, { recursive: true });"""
if old_helper not in test:
    raise SystemExit('timeline helper block not found')
test = test.replace(old_helper, new_helper, 1)
test_path.write_text(test)

docs_path = Path('docs/recommendation-dataset-v5.md')
docs = docs_path.read_text()
docs = docs.replace(
    'Recommendation Dataset V5 enriches Recommendation Dataset V4 decisions',
    '`RECOMMENDATION_DECISION_DATASET_V5_2` enriches Recommendation Dataset V4 decisions',
    1,
)
docs = docs.replace(
    '- the 3, 5, and 10 minute targets use snapshots in `(t, t + horizon]`;',
    '- the 3, 5, and 10 minute targets use snapshots in `(t, t + horizon]` and require a snapshot no more than `snapshotStalenessS` before the exact horizon boundary;',
    1,
)
docs_path.write_text(docs)
