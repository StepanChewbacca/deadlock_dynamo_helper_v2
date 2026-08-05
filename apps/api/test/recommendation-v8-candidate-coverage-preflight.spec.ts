import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import {
  generateRecommendationHistoricalCandidatesFromPreparedPolicy,
  prepareRecommendationSerializedHeroBuildPolicy,
  validateRecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationPreparedHeroBuildPolicy,
} from '../src/deadlock-live/recommendation-candidate-generator-snapshot';
import type { RecommendationHistoricalProReplayRow } from '../src/deadlock-live/recommendation-historical-pro-replay';

const replayPath = process.env.RECOMMENDATION_V8_PREFLIGHT_REPLAY_PATH;
const snapshotPath = process.env.RECOMMENDATION_V8_PREFLIGHT_SNAPSHOT_PATH;
const reportPath = process.env.RECOMMENDATION_V8_PREFLIGHT_REPORT_PATH;
const enabled = Boolean(replayPath && snapshotPath && reportPath);

jest.setTimeout(90 * 60 * 1_000);

(enabled ? describe : describe.skip)(
  'Recommendation V8 candidate coverage preflight',
  () => {
    it('projects at least 99.5% coverage without observed-action injection', async () => {
      const artifact = JSON.parse(
        await readFile(snapshotPath as string, 'utf8'),
      ) as RecommendationCandidateGeneratorSnapshotArtifact;
      validateRecommendationCandidateGeneratorSnapshotArtifact(artifact);
      const policies = new Map<number, RecommendationPreparedHeroBuildPolicy>();
      let rowCount = 0;
      let existingCoveredCount = 0;
      let recoveredCount = 0;
      let remainingMissingCount = 0;

      const input = createReadStream(replayPath as string, { encoding: 'utf8' });
      const lines = createInterface({ input, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const row = JSON.parse(line) as RecommendationHistoricalProReplayRow;
        rowCount += 1;
        if (row.observedAction.inCandidateSet) {
          existingCoveredCount += 1;
          continue;
        }
        if (row.generatorSnapshot.snapshotId !== artifact.snapshot.snapshotId) {
          throw new Error(
            `Unexpected snapshot ${row.generatorSnapshot.snapshotId} in preflight.`,
          );
        }
        let policy = policies.get(row.heroId);
        if (!policy) {
          const serialized = artifact.policies.find(
            (value) => value.heroId === row.heroId,
          );
          if (!serialized) {
            remainingMissingCount += 1;
            continue;
          }
          policy = prepareRecommendationSerializedHeroBuildPolicy(serialized);
          policies.set(row.heroId, policy);
        }
        const decision = {
          matchStartTime: row.matchStartTime,
          heroId: row.heroId,
          inventoryBeforeStateKey: row.state.inventoryBeforeStateKey,
          gameTimeS: row.decisionGameTimeS,
        } as unknown as HeroBuildDecisionDatasetV3Row;
        const candidates =
          generateRecommendationHistoricalCandidatesFromPreparedPolicy({
            decision,
            snapshot: artifact.snapshot,
            generatorOptions: artifact.generatorOptions,
            catalog: artifact.catalog,
            policy,
            historicalCandidateLimit: 256,
          });
        if (
          candidates.some(
            (candidate) =>
              candidate.actionKey === row.observedAction.actionKey,
          )
        ) {
          recoveredCount += 1;
        } else {
          remainingMissingCount += 1;
        }
      }

      const projectedCoveredCount = existingCoveredCount + recoveredCount;
      const projectedCoverage =
        rowCount > 0 ? projectedCoveredCount / rowCount : 0;
      const report = {
        schemaVersion: 1,
        rowCount,
        existingCoveredCount,
        recoveredCount,
        remainingMissingCount,
        projectedCoveredCount,
        projectedCoverage,
        minimumRequiredCoverage: 0.995,
        observedActionInjected: false,
        historicalCandidateLimit: 256,
      };
      await writeFile(
        reportPath as string,
        `${JSON.stringify(report, null, 2)}\n`,
      );

      expect(projectedCoverage).toBeGreaterThanOrEqual(0.995);
    });
  },
);
