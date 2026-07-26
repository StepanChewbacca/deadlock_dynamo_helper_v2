import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const resultDirectory =
  process.env.RECOMMENDATION_V6_SWEEP_RESULT_DIR ??
  join(process.env.GITHUB_WORKSPACE ?? process.cwd(), 'recommendation-v6-improvement-result');

const v6 = await readJson(join(resultDirectory, '99-summary.json'));
const v7 = await readJson(join(resultDirectory, '50-v7-catboost-report.json'));
const v7Policy = await readJson(join(resultDirectory, '60-v7-policy-report.json'));

const baseline = normalizeV6(v6.baseline, 'V6 baseline');
const bestV6 = normalizeV6(v6.winner, 'Best V6 sweep candidate');
const v7Value = normalizeV7(v7);
const v7PolicySummary = normalizePolicy(v7Policy);
const bestV6Policy = normalizePolicy({ evaluation: v6.policy?.evaluation });

const progressionThresholds = {
  meanTopCandidateSeparation: 0.002,
  policyDoublyRobustDelta: 0.001,
  candidateCoverage: 0.99,
  behaviorSupport: 0.85,
  effectiveSampleSizeRatio: 0.5,
  clippedWeightRateMaximum: 0.1,
};

const v7Checks = {
  meanSeparation:
    v7Value.averageTopCandidateSeparation >=
    progressionThresholds.meanTopCandidateSeparation,
  policyDrDelta:
    v7PolicySummary.doublyRobustDelta >=
    progressionThresholds.policyDoublyRobustDelta,
  candidateCoverage:
    v7PolicySummary.candidateCoverage >=
    progressionThresholds.candidateCoverage,
  behaviorSupport:
    v7PolicySummary.behaviorSupport >= progressionThresholds.behaviorSupport,
  effectiveSampleSize:
    v7PolicySummary.effectiveSampleSizeRatio >=
    progressionThresholds.effectiveSampleSizeRatio,
  clipping:
    v7PolicySummary.clippedWeightRate <=
    progressionThresholds.clippedWeightRateMaximum,
};

const allProgressionChecksPassed = Object.values(v7Checks).every(Boolean);
const valueWinner = [baseline, bestV6, v7Value].sort(compareValueCandidates)[0];
const nextStage = determineNextStage({
  allProgressionChecksPassed,
  v7Value,
  v7PolicySummary,
  bestV6,
});

const report = {
  generatedAt: new Date().toISOString(),
  immutableBaseline: {
    datasetMatchCount: 6855,
    datasetRowCount: 1412843,
    timelineCoverage: 1,
    productionCommit: '251660fc3dd541925b8ade9c55d216a91a975d85',
  },
  comparison: {
    valueCandidates: [baseline, bestV6, v7Value],
    policyCandidates: [
      { name: 'Best V6 policy', ...bestV6Policy },
      { name: 'V7 policy', ...v7PolicySummary },
    ],
    valueWinner,
  },
  progressionThresholds,
  v7Checks,
  allProgressionChecksPassed,
  decision: {
    productionRolloutAuthorized: false,
    shadowRolloutAuthorized: allProgressionChecksPassed,
    nextStage,
  },
  roadmap: buildRoadmap(nextStage, {
    baseline,
    bestV6,
    v7Value,
    v7PolicySummary,
  }),
};

await writeFile(
  join(resultDirectory, '70-comparison-and-roadmap.json'),
  `${JSON.stringify(report, undefined, 2)}\n`,
  'utf8',
);
await writeFile(
  join(resultDirectory, '70-comparison-and-roadmap.md'),
  renderMarkdown(report),
  'utf8',
);
console.log(JSON.stringify(report, undefined, 2));

function normalizeV6(value, name) {
  const test = value?.test ?? {};
  const metrics = test.metrics ?? {};
  const ranking = test.ranking ?? {};
  return {
    name,
    modelKind: 'V6_LOOKUP_RESIDUAL',
    selectionScore: finite(value?.selectionScore),
    actionRmse: finite(metrics.actionRmse),
    utilityRmseImprovement: finite(metrics.utilityRmseImprovement),
    actionSupportCoverage: finite(metrics.actionSupportCoverage),
    shortHorizonCoverage: finite(metrics.shortHorizonCoverage),
    observedActionTop1Agreement: finite(metrics.observedActionTop1Agreement),
    observedActionMeanReciprocalRank: finite(
      metrics.observedActionMeanReciprocalRank,
    ),
    pairwiseObservedActionAccuracy: finite(
      ranking.pairwiseObservedActionAccuracy,
    ),
    observedActionNdcg: finite(ranking.observedActionNdcg),
    averageTopCandidateSeparation: finite(
      metrics.averageTopCandidateSeparation,
    ),
    confidentSeparationRate: finite(ranking.confidentSeparationRate),
    releaseGatePassed: value?.releaseGate?.passed === true,
    config: value?.config,
  };
}

function normalizeV7(value) {
  const test = value?.evaluation?.test ?? {};
  return {
    name: 'V7 CatBoost candidate scorer',
    modelKind: 'V7_CATBOOST_STATE_PLUS_CANDIDATE',
    selectionScore: finite(value?.evaluation?.tuning?.actionRmse),
    actionRmse: finite(test.actionRmse),
    utilityRmseImprovement: finite(test.utilityRmseImprovement),
    actionSupportCoverage: 1,
    shortHorizonCoverage: finite(test.shortHorizonCoverage),
    observedActionTop1Agreement: finite(test.observedActionTop1Agreement),
    observedActionMeanReciprocalRank: finite(
      test.observedActionMeanReciprocalRank,
    ),
    pairwiseObservedActionAccuracy: finite(
      test.pairwiseObservedActionAccuracy,
    ),
    observedActionNdcg: finite(test.observedActionNdcg),
    averageTopCandidateSeparation: finite(
      test.averageTopCandidateSeparation,
    ),
    separationP50: finite(test.separationP50),
    separationP90: finite(test.separationP90),
    separationP99: finite(test.separationP99),
    confidentSeparationRate: finite(test.separationRateAtLeast0010),
    releaseGatePassed: value?.evaluation?.releaseGate?.passed === true,
  };
}

function normalizePolicy(value) {
  const evaluation = value?.evaluation ?? {};
  const coverage = evaluation.coverage ?? {};
  const diagnostics = evaluation.diagnostics ?? {};
  const estimators = evaluation.estimators ?? {};
  return {
    candidateCoverage: finite(
      coverage.candidateCoverage ?? coverage.candidateCoveredDecisionRate,
    ),
    behaviorSupport: finite(
      coverage.behaviorSupport ?? coverage.behaviorSupportedDecisionRate,
    ),
    evaluatedDecisionCount: finite(coverage.evaluatedDecisionCount),
    evaluatedMatchCount: finite(coverage.evaluatedMatchCount),
    effectiveSampleSizeRatio: finite(
      estimators.effectiveSampleSizeRatio ?? diagnostics.effectiveSampleSizeRatio,
    ),
    clippedWeightRate: finite(
      diagnostics.clippedWeightRate ?? diagnostics.clippedWeightDecisionRate,
    ),
    observedValue: finite(estimators.observedValue),
    doublyRobustValue: finite(estimators.doublyRobustValue),
    doublyRobustDelta: finite(
      estimators?.deltasVsObserved?.doublyRobust,
    ),
    doublyRobustLower95: finite(
      evaluation?.bootstrap?.intervals?.doublyRobustDelta?.lower,
    ),
    releaseGatePassed: evaluation?.releaseGate?.passed === true,
  };
}

function compareValueCandidates(left, right) {
  return (
    right.averageTopCandidateSeparation - left.averageTopCandidateSeparation ||
    right.utilityRmseImprovement - left.utilityRmseImprovement ||
    left.actionRmse - right.actionRmse ||
    left.name.localeCompare(right.name)
  );
}

function determineNextStage({
  allProgressionChecksPassed,
  v7Value,
  v7PolicySummary,
  bestV6,
}) {
  if (allProgressionChecksPassed) {
    return 'SHADOW_V7';
  }
  if (
    v7Value.averageTopCandidateSeparation < 0.002 &&
    bestV6.averageTopCandidateSeparation < 0.002
  ) {
    return 'REDESIGN_TARGET_AND_COLLECT_MORE_MATCHES';
  }
  if (v7PolicySummary.doublyRobustDelta < 0.001) {
    return 'IMPROVE_PROPENSITY_AND_CAUSAL_IDENTIFICATION';
  }
  if (
    v7PolicySummary.candidateCoverage < 0.99 ||
    v7PolicySummary.behaviorSupport < 0.85
  ) {
    return 'IMPROVE_CANDIDATE_AND_BEHAVIOR_SUPPORT';
  }
  return 'ITERATE_OFFLINE_MODEL';
}

function buildRoadmap(nextStage, values) {
  const common = [
    {
      priority: 0,
      action: 'Keep production on the current baseline.',
      exitCriteria: 'No production change from this execution-only program.',
    },
    {
      priority: 1,
      action:
        'Preserve the untouched chronological test split and create a new future holdout before any production decision.',
      exitCriteria:
        'A later data window is frozen and never used for feature, target, or hyperparameter selection.',
    },
  ];
  if (nextStage === 'SHADOW_V7') {
    return [
      ...common,
      {
        priority: 2,
        action:
          'Integrate V7 as shadow-only scoring behind a feature flag with full candidate telemetry.',
        exitCriteria:
          'At least 20,000 shadow decisions with zero runtime regressions and stable score distributions.',
      },
      {
        priority: 3,
        action:
          'Run prospective OPE and calibration checks on the new holdout.',
        exitCriteria:
          'DR uplift lower confidence bound is positive and mean separation remains at least 0.002.',
      },
    ];
  }
  if (nextStage === 'REDESIGN_TARGET_AND_COLLECT_MORE_MATCHES') {
    return [
      ...common,
      {
        priority: 2,
        action:
          'Replace the scalar handcrafted short-horizon target with multi-task outcomes and a learned state residual.',
        exitCriteria:
          'Each horizon has independently calibrated net-worth, death, kill-participation, damage, and objective heads.',
      },
      {
        priority: 3,
        action:
          'Collect and backfill at least 20,000 matches, then build 25/50/75/100 percent learning curves.',
        exitCriteria:
          'Learning curves show whether separation and DR uplift are data-limited or architecture-limited.',
      },
      {
        priority: 4,
        action:
          'Train pairwise/listwise ranking models using matched candidate cohorts and propensity-aware weights.',
        exitCriteria:
          'Held-out mean separation reaches 0.002 and DR uplift reaches 0.001 without support regression.',
      },
    ];
  }
  if (nextStage === 'IMPROVE_PROPENSITY_AND_CAUSAL_IDENTIFICATION') {
    return [
      ...common,
      {
        priority: 2,
        action:
          'Rebuild the behavior model with richer state features, calibration, and cross-fitted propensities.',
        exitCriteria:
          'Behavior support stays at least 85%, probability calibration improves, and OPE sensitivity is stable across clipping thresholds.',
      },
      {
        priority: 3,
        action:
          'Add matched-cohort and doubly robust residual diagnostics by hero, time, item tier, and economy state.',
        exitCriteria:
          'Positive uplift is not concentrated in unsupported or highly weighted cohorts.',
      },
    ];
  }
  if (nextStage === 'IMPROVE_CANDIDATE_AND_BEHAVIOR_SUPPORT') {
    return [
      ...common,
      {
        priority: 2,
        action:
          'Align candidate generation with behavioral validation and remove unreachable candidate actions.',
        exitCriteria: 'Candidate coverage is at least 99%.',
      },
      {
        priority: 3,
        action:
          'Increase behavior-model support using hierarchical smoothing and calibrated fallback contexts.',
        exitCriteria: 'Behavior support is at least 85% with stable ESS.',
      },
    ];
  }
  return [
    ...common,
    {
      priority: 2,
      action:
        'Iterate CatBoost depth, regularization, candidate interactions, and pairwise ranking loss using tuning only.',
      exitCriteria:
        'V7 exceeds both best V6 separation and RMSE lift on a new frozen holdout.',
    },
  ];
}

function renderMarkdown(report) {
  const values = report.comparison.valueCandidates;
  const policies = report.comparison.policyCandidates;
  const checks = Object.entries(report.v7Checks)
    .map(([name, passed]) => `- ${name}: ${passed ? 'PASS' : 'FAIL'}`)
    .join('\n');
  const roadmap = report.roadmap
    .map(
      (step) =>
        `${step.priority}. ${step.action}\n   Exit: ${step.exitCriteria}`,
    )
    .join('\n');
  return `# Recommendation V6/V7 comparison\n\nGenerated: ${report.generatedAt}\n\n## Value models\n\n${values
    .map(
      (value) =>
        `- ${value.name}: separation=${format(value.averageTopCandidateSeparation)}, RMSE lift=${format(value.utilityRmseImprovement)}, pairwise=${format(value.pairwiseObservedActionAccuracy)}, NDCG=${format(value.observedActionNdcg)}`,
    )
    .join('\n')}\n\n## Policy OPE\n\n${policies
    .map(
      (value) =>
        `- ${value.name}: DR delta=${format(value.doublyRobustDelta)}, lower95=${format(value.doublyRobustLower95)}, candidate coverage=${format(value.candidateCoverage)}, behavior support=${format(value.behaviorSupport)}, ESS ratio=${format(value.effectiveSampleSizeRatio)}`,
    )
    .join('\n')}\n\n## V7 progression checks\n\n${checks}\n\n## Decision\n\n- Production rollout: NOT AUTHORIZED\n- Shadow rollout: ${report.decision.shadowRolloutAuthorized ? 'AUTHORIZED' : 'NOT AUTHORIZED'}\n- Next stage: ${report.decision.nextStage}\n\n## Roadmap\n\n${roadmap}\n`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function finite(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function format(value) {
  return Number(value).toFixed(8);
}
