#!/usr/bin/env python3

from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def patch_artifact_service() -> None:
    path = Path(
        "apps/api/src/deadlock-live/"
        "recommendation-historical-pro-replay-artifact.service.ts"
    )
    replace_once(
        path,
        """      stats.selectedRowCount += 1;
      const policy = await loadPreparedPolicy(
""",
        """      const policy = await loadPreparedPolicy(
""",
    )
    replace_once(
        path,
        """      const outcomes =
        buildRecommendationHistoricalShortHorizonOutcomes({
          decision: row,
          snapshots: timeline.snapshots,
          objectives: timeline.objectives,
          matchEndGameTimeS: timeline.matchEndGameTimeS,
          snapshotStalenessS: input.snapshotStalenessS,
        });
      const replayRow = createRecommendationHistoricalProReplayRow({
""",
        """      const outcomes =
        buildRecommendationHistoricalShortHorizonOutcomes({
          decision: row,
          snapshots: timeline.snapshots,
          objectives: timeline.objectives,
          matchEndGameTimeS: timeline.matchEndGameTimeS,
          snapshotStalenessS: input.snapshotStalenessS,
        });
      const completeOutcomeAvailable = outcomes.some(
        (outcome) => outcome.complete && outcome.utility !== undefined,
      );
      if (!decisionTimelineJoined && !completeOutcomeAvailable) {
        stats.excludedWithoutTimelineCount += 1;
        continue;
      }
      stats.selectedRowCount += 1;
      const replayRow = createRecommendationHistoricalProReplayRow({
""",
    )


def patch_artifact_test() -> None:
    path = Path(
        "apps/api/test/recommendation-historical-pro-replay-artifact.spec.ts"
    )
    replace_once(
        path,
        """  });
});

async function writeSourceArtifact(directory: string): Promise<void> {
  const row = sourceDecision();
""",
        """  });

  it('excludes decisions before the first leak-free timeline snapshot', async () => {
    const sourceDirectory = join(root, 'source');
    const snapshotDirectory = join(root, 'snapshots');
    const timelineDirectory = join(root, 'timeline');
    const outputDirectory = join(root, 'output');
    await Promise.all([
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(snapshotDirectory, { recursive: true }),
      mkdir(timelineDirectory, { recursive: true }),
    ]);

    await writeSourceArtifact(sourceDirectory, { gameTimeS: 120 });
    const registryPath = await writeSnapshotRegistry(snapshotDirectory);
    await writeTimeline(timelineDirectory);

    process.env.DEADLOCK_RECOMMENDATION_HISTORICAL_PRO_REPLAY_SOURCE_DIR =
      sourceDirectory;
    process.env.DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_PATH =
      registryPath;
    process.env.DEADLOCK_TIMELINE_STORAGE_DIR = timelineDirectory;
    process.env.DEADLOCK_RECOMMENDATION_HISTORICAL_PRO_REPLAY_DIR =
      outputDirectory;

    const service = new RecommendationHistoricalProReplayArtifactService();
    await service.onModuleInit();
    await service.start({
      partitionCount: 2,
      resume: false,
      thresholds: {
        minimumTimelineCoverage: 1,
        minimumCandidateMetadataCoverage: 1,
        minimumObservedActionCandidateCoverage: 1,
      },
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      sourceRowCount: 1,
      selectedSourceRowCount: 0,
      outputRowCount: 0,
      excludedWithoutTimelineCount: 1,
      auditPassed: false,
    });
    expect(service.getManifest()).toMatchObject({
      source: {
        scannedRowCount: 1,
        selectedRowCount: 0,
      },
      artifact: {
        rowCount: 0,
      },
      auditPassed: false,
      trainingArtifactEligible: false,
    });
    expect(service.getAudit()).toMatchObject({
      passed: false,
      rowCount: 0,
      source: {
        scannedRowCount: 1,
        selectedRowCount: 0,
        excludedWithoutTimelineCount: 1,
      },
      trainingArtifactEligible: false,
    });
  });
});

async function writeSourceArtifact(
  directory: string,
  overrides: Partial<HeroBuildDecisionDatasetV3Row> = {},
): Promise<void> {
  const row = { ...sourceDecision(), ...overrides };
""",
    )


def main() -> None:
    patch_artifact_service()
    patch_artifact_test()


if __name__ == "__main__":
    main()
