from pathlib import Path
import re


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label} occurrence, found {count}")
    return content.replace(old, new, 1)


def replace_regex(content: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, content, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label} regex match, found {count}")
    return updated


service_path = Path("apps/api/src/deadlock-live/recommendation-value-v4-training.service.ts")
service = service_path.read_text()
service = replace_once(
    service,
    "'RECOMMENDATION_VALUE_V4_HIERARCHICAL_BETA_BINOMIAL_1' as const;",
    "'RECOMMENDATION_VALUE_V4_CONTEXTUAL_LOGIT_RESIDUAL_2' as const;",
    "value model version",
)
service = replace_once(
    service,
    """interface RecommendationValueV4Model {
  global: BinaryCount;
  hero: BinaryCountTable;
  heroTime: BinaryCountTable;
  heroTimeAction: BinaryCountTable;
  heroTimeInventoryAction: BinaryCountTable;
  heroTimePreviousTailAction: BinaryCountTable;
  allyAction: BinaryCountTable;
  enemyAction: BinaryCountTable;
}
""",
    """interface RecommendationValueV4Model {
  global: BinaryCount;
  hero: BinaryCountTable;
  heroTime: BinaryCountTable;
  heroTeamTime: BinaryCountTable;
  heroTimeInventory: BinaryCountTable;
  heroTimePreviousTail: BinaryCountTable;
  ally: BinaryCountTable;
  enemy: BinaryCountTable;
  heroTimeAction: BinaryCountTable;
  heroTimeInventoryAction: BinaryCountTable;
  heroTimePreviousTailAction: BinaryCountTable;
  allyAction: BinaryCountTable;
  enemyAction: BinaryCountTable;
}
""",
    "value model interface",
)
service = replace_once(
    service,
    """        weights: {
          base: 1,
          heroTimeAction: 1.5,
          inventoryAction: 0.75,
          previousActionTailAction: 0.5,
          alliedRosterActionAverage: 0.2,
          enemyRosterActionAverage: 0.3,
        },
""",
    """        combination: 'SHRUNK_CONTEXT_LOGIT_RESIDUALS',
        maximumAbsoluteLogitResidual: 1.5,
        weights: {
          heroTeamTime: 0.7,
          inventory: 0.35,
          previousActionTail: 0.2,
          alliedRosterAverage: 0.12,
          enemyRosterAverage: 0.18,
          heroTimeAction: 0.45,
          inventoryAction: 0.2,
          previousActionTailAction: 0.12,
          alliedRosterActionAverage: 0.05,
          enemyRosterActionAverage: 0.08,
        },
""",
    "serialized weights",
)
service = replace_once(
    service,
    """function createModel(): RecommendationValueV4Model {
  return {
    global: { wins: 0, total: 0 },
    hero: new Map(),
    heroTime: new Map(),
    heroTimeAction: new Map(),
    heroTimeInventoryAction: new Map(),
    heroTimePreviousTailAction: new Map(),
    allyAction: new Map(),
    enemyAction: new Map(),
  };
}
""",
    """function createModel(): RecommendationValueV4Model {
  return {
    global: { wins: 0, total: 0 },
    hero: new Map(),
    heroTime: new Map(),
    heroTeamTime: new Map(),
    heroTimeInventory: new Map(),
    heroTimePreviousTail: new Map(),
    ally: new Map(),
    enemy: new Map(),
    heroTimeAction: new Map(),
    heroTimeInventoryAction: new Map(),
    heroTimePreviousTailAction: new Map(),
    allyAction: new Map(),
    enemyAction: new Map(),
  };
}
""",
    "create model",
)
service = replace_regex(
    service,
    r"function updateModel\(.*?\n}\n\nfunction predictGlobal",
    """function updateModel(
  model: RecommendationValueV4Model,
  row: RecommendationValueV4PreparedRow,
): void {
  const features = row.features;
  const won = row.target.playerWon;
  incrementBinaryCount(model.global, won);
  const heroKey = String(features.heroId);
  const baseKey = `${features.heroId}|${features.timeBucket}`;
  const teamKey = `${baseKey}|${features.teamId ?? 'UNKNOWN_TEAM'}`;
  const actionKey = features.actionKey;
  incrementBinaryTable(model.hero, heroKey, won);
  incrementBinaryTable(model.heroTime, baseKey, won);
  incrementBinaryTable(model.heroTeamTime, teamKey, won);
  incrementBinaryTable(
    model.heroTimeInventory,
    `${baseKey}|${features.inventoryStateKey}`,
    won,
  );
  incrementBinaryTable(
    model.heroTimePreviousTail,
    `${baseKey}|${features.previousActionTailKey}`,
    won,
  );
  for (const allyHeroId of features.alliedHeroIds) {
    incrementBinaryTable(model.ally, `${baseKey}|${allyHeroId}`, won);
  }
  for (const enemyHeroId of features.enemyHeroIds) {
    incrementBinaryTable(model.enemy, `${baseKey}|${enemyHeroId}`, won);
  }
  incrementBinaryTable(model.heroTimeAction, `${baseKey}|${actionKey}`, won);
  incrementBinaryTable(
    model.heroTimeInventoryAction,
    `${baseKey}|${features.inventoryStateKey}|${actionKey}`,
    won,
  );
  incrementBinaryTable(
    model.heroTimePreviousTailAction,
    `${baseKey}|${features.previousActionTailKey}|${actionKey}`,
    won,
  );
  for (const allyHeroId of features.alliedHeroIds) {
    incrementBinaryTable(
      model.allyAction,
      `${baseKey}|${allyHeroId}|${actionKey}`,
      won,
    );
  }
  for (const enemyHeroId of features.enemyHeroIds) {
    incrementBinaryTable(
      model.enemyAction,
      `${baseKey}|${enemyHeroId}|${actionKey}`,
      won,
    );
  }
}

function predictGlobal""",
    "update model function",
)
service = replace_regex(
    service,
    r"function predictValue\(.*?\n}\n\nfunction posteriorProbability",
    """function predictValue(
  model: RecommendationValueV4Model,
  row: RecommendationValueV4PreparedRow,
  options: RecommendationValueV4TrainingOptions,
): number {
  const features = row.features;
  const baseKey = `${features.heroId}|${features.timeBucket}`;
  const base = predictHeroTime(model, row, options);
  const baseLogit = probabilityLogit(base);
  let residual = 0;
  const addResidual = (
    count: BinaryCount | undefined,
    weight: number,
  ): void => {
    if (!hasMinimumObservations(count, options.minContextObservations)) {
      return;
    }
    const probability = posteriorProbability(
      count,
      base,
      options.priorStrength,
    );
    residual += weight * (probabilityLogit(probability) - baseLogit);
  };
  const addAverageResidual = (
    counts: readonly (BinaryCount | undefined)[],
    weight: number,
  ): void => {
    const deltas = counts
      .filter((count) =>
        hasMinimumObservations(count, options.minContextObservations),
      )
      .map((count) =>
        probabilityLogit(
          posteriorProbability(count, base, options.priorStrength),
        ) - baseLogit,
      );
    if (deltas.length > 0) {
      residual += weight * average(deltas);
    }
  };

  addResidual(
    model.heroTeamTime.get(
      `${baseKey}|${features.teamId ?? 'UNKNOWN_TEAM'}`,
    ),
    0.7,
  );
  addResidual(
    model.heroTimeInventory.get(`${baseKey}|${features.inventoryStateKey}`),
    0.35,
  );
  addResidual(
    model.heroTimePreviousTail.get(
      `${baseKey}|${features.previousActionTailKey}`,
    ),
    0.2,
  );
  addAverageResidual(
    features.alliedHeroIds.map((heroId) =>
      model.ally.get(`${baseKey}|${heroId}`),
    ),
    0.12,
  );
  addAverageResidual(
    features.enemyHeroIds.map((heroId) =>
      model.enemy.get(`${baseKey}|${heroId}`),
    ),
    0.18,
  );
  addResidual(
    model.heroTimeAction.get(`${baseKey}|${features.actionKey}`),
    0.45,
  );
  addResidual(
    model.heroTimeInventoryAction.get(
      `${baseKey}|${features.inventoryStateKey}|${features.actionKey}`,
    ),
    0.2,
  );
  addResidual(
    model.heroTimePreviousTailAction.get(
      `${baseKey}|${features.previousActionTailKey}|${features.actionKey}`,
    ),
    0.12,
  );
  addAverageResidual(
    features.alliedHeroIds.map((heroId) =>
      model.allyAction.get(`${baseKey}|${heroId}|${features.actionKey}`),
    ),
    0.05,
  );
  addAverageResidual(
    features.enemyHeroIds.map((heroId) =>
      model.enemyAction.get(`${baseKey}|${heroId}|${features.actionKey}`),
    ),
    0.08,
  );

  return clampProbability(
    probabilityFromLogit(baseLogit + clamp(residual, -1.5, 1.5)),
  );
}

function probabilityLogit(probability: number): number {
  const normalized = clampProbability(probability);
  return Math.log(normalized / (1 - normalized));
}

function probabilityFromLogit(value: number): number {
  if (value >= 0) {
    const exponent = Math.exp(-value);
    return 1 / (1 + exponent);
  }
  const exponent = Math.exp(value);
  return exponent / (1 + exponent);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function posteriorProbability""",
    "predict value function",
)
service = replace_once(
    service,
    """  return {
    global: { ...model.global },
    hero: serializeBinaryTable(model.hero),
    heroTime: serializeBinaryTable(model.heroTime),
    heroTimeAction: serializeBinaryTable(model.heroTimeAction),
""",
    """  return {
    global: { ...model.global },
    hero: serializeBinaryTable(model.hero),
    heroTime: serializeBinaryTable(model.heroTime),
    heroTeamTime: serializeBinaryTable(model.heroTeamTime),
    heroTimeInventory: serializeBinaryTable(model.heroTimeInventory),
    heroTimePreviousTail: serializeBinaryTable(model.heroTimePreviousTail),
    ally: serializeBinaryTable(model.ally),
    enemy: serializeBinaryTable(model.enemy),
    heroTimeAction: serializeBinaryTable(model.heroTimeAction),
""",
    "serialize model context tables",
)
service = replace_once(
    service,
    """      20,
      0.1,
      10_000,
""",
    """      100,
      0.1,
      10_000,
""",
    "prior strength default",
)
service = replace_once(
    service,
    """      5,
      1,
      100_000,
""",
    """      20,
      1,
      100_000,
""",
    "minimum context default",
)
service_path.write_text(service)

policy_path = Path("apps/api/src/deadlock-live/recommendation-policy-v4-evaluation.service.ts")
policy = policy_path.read_text()
policy = replace_once(
    policy,
    """  weights: {
    heroTimeAction: number;
    inventoryAction: number;
    previousActionTailAction: number;
    alliedRosterActionAverage: number;
    enemyRosterActionAverage: number;
  };
  counts: {
    global: BinaryCount;
    hero: BinaryCountTableRecord;
    heroTime: BinaryCountTableRecord;
    heroTimeAction: BinaryCountTableRecord;
""",
    """  maximumAbsoluteLogitResidual: number;
  weights: {
    heroTeamTime: number;
    inventory: number;
    previousActionTail: number;
    alliedRosterAverage: number;
    enemyRosterAverage: number;
    heroTimeAction: number;
    inventoryAction: number;
    previousActionTailAction: number;
    alliedRosterActionAverage: number;
    enemyRosterActionAverage: number;
  };
  counts: {
    global: BinaryCount;
    hero: BinaryCountTableRecord;
    heroTime: BinaryCountTableRecord;
    heroTeamTime: BinaryCountTableRecord;
    heroTimeInventory: BinaryCountTableRecord;
    heroTimePreviousTail: BinaryCountTableRecord;
    ally: BinaryCountTableRecord;
    enemy: BinaryCountTableRecord;
    heroTimeAction: BinaryCountTableRecord;
""",
    "policy value model interface",
)
policy = replace_regex(
    policy,
    r"function valueProbability\(.*?\n}\n\nfunction buildReleaseGate",
    """function valueProbability(
  row: RecommendationBehavioralV4PreparedRow,
  actionKey: string,
  model: ValueSerializedModel,
): number {
  const features = row.features;
  const baseKey = `${features.heroId}|${features.timeBucket}`;
  const globalProbability = clampProbability(
    (model.counts.global.wins + 1) / (model.counts.global.total + 2),
  );
  const heroProbability = posteriorProbability(
    model.counts.hero[String(features.heroId)],
    globalProbability,
    model.options.priorStrength,
  );
  const heroTimeCount = model.counts.heroTime[baseKey];
  const base = hasMinimumBinaryObservations(
    heroTimeCount,
    model.options.minContextObservations,
  )
    ? posteriorProbability(
        heroTimeCount,
        heroProbability,
        model.options.priorStrength,
      )
    : heroProbability;
  const baseLogit = probabilityLogit(base);
  let residual = 0;
  const addResidual = (
    count: BinaryCount | undefined,
    weight: number,
  ): void => {
    if (
      !hasMinimumBinaryObservations(
        count,
        model.options.minContextObservations,
      )
    ) {
      return;
    }
    residual +=
      weight *
      (probabilityLogit(
        posteriorProbability(count, base, model.options.priorStrength),
      ) -
        baseLogit);
  };
  const addAverageResidual = (
    counts: readonly (BinaryCount | undefined)[],
    weight: number,
  ): void => {
    const deltas = counts
      .filter((count) =>
        hasMinimumBinaryObservations(
          count,
          model.options.minContextObservations,
        ),
      )
      .map(
        (count) =>
          probabilityLogit(
            posteriorProbability(count, base, model.options.priorStrength),
          ) - baseLogit,
      );
    if (deltas.length > 0) {
      residual += weight * average(deltas);
    }
  };

  addResidual(
    model.counts.heroTeamTime[
      `${baseKey}|${features.teamId ?? 'UNKNOWN_TEAM'}`
    ],
    model.weights.heroTeamTime,
  );
  addResidual(
    model.counts.heroTimeInventory[
      `${baseKey}|${features.inventoryStateKey}`
    ],
    model.weights.inventory,
  );
  addResidual(
    model.counts.heroTimePreviousTail[
      `${baseKey}|${features.previousActionTailKey}`
    ],
    model.weights.previousActionTail,
  );
  addAverageResidual(
    features.alliedHeroIds.map(
      (heroId) => model.counts.ally[`${baseKey}|${heroId}`],
    ),
    model.weights.alliedRosterAverage,
  );
  addAverageResidual(
    features.enemyHeroIds.map(
      (heroId) => model.counts.enemy[`${baseKey}|${heroId}`],
    ),
    model.weights.enemyRosterAverage,
  );
  addResidual(
    model.counts.heroTimeAction[`${baseKey}|${actionKey}`],
    model.weights.heroTimeAction,
  );
  addResidual(
    model.counts.heroTimeInventoryAction[
      `${baseKey}|${features.inventoryStateKey}|${actionKey}`
    ],
    model.weights.inventoryAction,
  );
  addResidual(
    model.counts.heroTimePreviousTailAction[
      `${baseKey}|${features.previousActionTailKey}|${actionKey}`
    ],
    model.weights.previousActionTailAction,
  );
  addAverageResidual(
    features.alliedHeroIds.map(
      (heroId) => model.counts.allyAction[`${baseKey}|${heroId}|${actionKey}`],
    ),
    model.weights.alliedRosterActionAverage,
  );
  addAverageResidual(
    features.enemyHeroIds.map(
      (heroId) => model.counts.enemyAction[`${baseKey}|${heroId}|${actionKey}`],
    ),
    model.weights.enemyRosterActionAverage,
  );
  return clampProbability(
    probabilityFromLogit(
      baseLogit +
        clamp(
          residual,
          -model.maximumAbsoluteLogitResidual,
          model.maximumAbsoluteLogitResidual,
        ),
    ),
  );
}

function buildReleaseGate""",
    "policy value probability",
)
policy_path.write_text(policy)

test_path = Path("apps/api/test/recommendation-value-v4-training.spec.ts")
test = test_path.read_text()
test = replace_once(
    test,
    """    expect(model).toMatchObject({
      modelVersion: RECOMMENDATION_VALUE_V4_MODEL_VERSION,
      modelKind: 'OBSERVATIONAL_WIN_PROBABILITY',
      target: 'PLAYER_WON',
      causalInterpretationAllowed: false,
    });
""",
    """    expect(model).toMatchObject({
      modelVersion: RECOMMENDATION_VALUE_V4_MODEL_VERSION,
      modelKind: 'OBSERVATIONAL_WIN_PROBABILITY',
      target: 'PLAYER_WON',
      causalInterpretationAllowed: false,
      combination: 'SHRUNK_CONTEXT_LOGIT_RESIDUALS',
      maximumAbsoluteLogitResidual: 1.5,
      counts: {
        heroTeamTime: expect.any(Object),
        heroTimeInventory: expect.any(Object),
        heroTimePreviousTail: expect.any(Object),
        ally: expect.any(Object),
        enemy: expect.any(Object),
      },
    });
""",
    "model test expectation",
)
test_path.write_text(test)

doc_path = Path("docs/recommendation-value-v4-training.md")
doc = doc_path.read_text()
doc += """

## Contextual residual model revision

The second model revision keeps the chronological match-level split and beta-binomial shrinkage, but combines supported context evidence as bounded log-odds residuals around the hero/time prior. It adds team side, inventory, previous-action history, allied roster, and enemy roster context both with and without the hypothetical action. The default shrinkage settings are `priorStrength = 100` and `minContextObservations = 20`, selected from the historical tuning sweep. The release gate remains unchanged and must still pass before any policy-selection use.
"""
doc_path.write_text(doc)
