from pathlib import Path


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label} occurrence, found {count}")
    return content.replace(old, new, 1)


policy_path = Path("apps/api/src/deadlock-live/recommendation-policy-v4-evaluation.service.ts")
policy = policy_path.read_text()
policy = replace_once(
    policy,
    """    !isPositiveNumber(options.priorStrength) ||
    !isPositiveInteger(options.minContextObservations) ||
    !isFiniteNumber(weights.heroTimeAction) ||
    !isFiniteNumber(weights.inventoryAction) ||
    !isFiniteNumber(weights.previousActionTailAction) ||
    !isFiniteNumber(weights.alliedRosterActionAverage) ||
    !isFiniteNumber(weights.enemyRosterActionAverage)
""",
    """    !isPositiveNumber(options.priorStrength) ||
    !isPositiveInteger(options.minContextObservations) ||
    !isPositiveNumber(value.maximumAbsoluteLogitResidual) ||
    !isFiniteNumber(weights.heroTeamTime) ||
    !isFiniteNumber(weights.inventory) ||
    !isFiniteNumber(weights.previousActionTail) ||
    !isFiniteNumber(weights.alliedRosterAverage) ||
    !isFiniteNumber(weights.enemyRosterAverage) ||
    !isFiniteNumber(weights.heroTimeAction) ||
    !isFiniteNumber(weights.inventoryAction) ||
    !isFiniteNumber(weights.previousActionTailAction) ||
    !isFiniteNumber(weights.alliedRosterActionAverage) ||
    !isFiniteNumber(weights.enemyRosterActionAverage)
""",
    "value model validation",
)
policy = replace_once(
    policy,
    """    options: {
      priorStrength: options.priorStrength,
      minContextObservations: options.minContextObservations,
    },
    weights: {
      heroTimeAction: weights.heroTimeAction,
      inventoryAction: weights.inventoryAction,
      previousActionTailAction: weights.previousActionTailAction,
      alliedRosterActionAverage: weights.alliedRosterActionAverage,
      enemyRosterActionAverage: weights.enemyRosterActionAverage,
    },
    counts: {
      global: asBinaryCount(counts.global),
      hero: asBinaryCountTableRecord(counts.hero),
      heroTime: asBinaryCountTableRecord(counts.heroTime),
      heroTimeAction: asBinaryCountTableRecord(counts.heroTimeAction),
""",
    """    options: {
      priorStrength: options.priorStrength,
      minContextObservations: options.minContextObservations,
    },
    maximumAbsoluteLogitResidual: value.maximumAbsoluteLogitResidual,
    weights: {
      heroTeamTime: weights.heroTeamTime,
      inventory: weights.inventory,
      previousActionTail: weights.previousActionTail,
      alliedRosterAverage: weights.alliedRosterAverage,
      enemyRosterAverage: weights.enemyRosterAverage,
      heroTimeAction: weights.heroTimeAction,
      inventoryAction: weights.inventoryAction,
      previousActionTailAction: weights.previousActionTailAction,
      alliedRosterActionAverage: weights.alliedRosterActionAverage,
      enemyRosterActionAverage: weights.enemyRosterActionAverage,
    },
    counts: {
      global: asBinaryCount(counts.global),
      hero: asBinaryCountTableRecord(counts.hero),
      heroTime: asBinaryCountTableRecord(counts.heroTime),
      heroTeamTime: asBinaryCountTableRecord(counts.heroTeamTime),
      heroTimeInventory: asBinaryCountTableRecord(counts.heroTimeInventory),
      heroTimePreviousTail: asBinaryCountTableRecord(
        counts.heroTimePreviousTail,
      ),
      ally: asBinaryCountTableRecord(counts.ally),
      enemy: asBinaryCountTableRecord(counts.enemy),
      heroTimeAction: asBinaryCountTableRecord(counts.heroTimeAction),
""",
    "parsed value model fields",
)
policy = replace_once(
    policy,
    """function probabilityLogit(probability: number): number {
  const value = clampProbability(probability);
  return Math.log(value / (1 - value));
}

function clampProbability(value: number): number {
""",
    """function probabilityLogit(probability: number): number {
  const value = clampProbability(probability);
  return Math.log(value / (1 - value));
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

function clampProbability(value: number): number {
""",
    "policy probability helpers",
)
policy_path.write_text(policy)

spec_path = Path("apps/api/test/recommendation-policy-v4-evaluation.spec.ts")
spec = spec_path.read_text()
spec = replace_once(
    spec,
    """    weights: {
      base: 1,
      heroTimeAction: 1.5,
      inventoryAction: 0.75,
      previousActionTailAction: 0.5,
      alliedRosterActionAverage: 0.2,
      enemyRosterActionAverage: 0.3,
    },
    counts: {
      global: { wins: 30, total: 60 },
      hero: { '72': { wins: 30, total: 60 } },
      heroTime: { '72|1': { wins: 30, total: 60 } },
      heroTimeAction: {
""",
    """    combination: 'SHRUNK_CONTEXT_LOGIT_RESIDUALS',
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
    counts: {
      global: { wins: 30, total: 60 },
      hero: { '72': { wins: 30, total: 60 } },
      heroTime: { '72|1': { wins: 30, total: 60 } },
      heroTeamTime: { '72|1|1': { wins: 30, total: 60 } },
      heroTimeInventory: {
        '72|1|EMPTY': { wins: 15, total: 30 },
        '72|1|1x1': { wins: 15, total: 30 },
      },
      heroTimePreviousTail: {
        '72|1|EMPTY': { wins: 15, total: 30 },
        '72|1|BUY:1': { wins: 15, total: 30 },
      },
      ally: {},
      enemy: {},
      heroTimeAction: {
""",
    "policy test value model fixture",
)
spec_path.write_text(spec)
