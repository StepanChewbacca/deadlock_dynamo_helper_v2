from pathlib import Path

service_path = Path('apps/api/src/deadlock-live/hero-build-contextual-v3-training.service.ts')
service = service_path.read_text()

replacements = [
    (
        "interface Model {\n  hero: CountTable;",
        "interface Model {\n  global: CountMap;\n  hero: CountTable;",
    ),
    (
        "interface Metrics {\n  evaluatedDecisionCount: number;\n  top1Count: number;\n  top3Count: number;\n  reciprocalRankSum: number;\n}",
        "interface Metrics {\n  evaluatedDecisionCount: number;\n  top1Count: number;\n  top3Count: number;\n  reciprocalRankSum: number;\n}\n\ninterface CandidateSelection {\n  actions: string[];\n  actualActionObservedInTrain: boolean;\n  actualActionLegal: boolean;\n  actualActionRankBeforeLimit: number;\n}\n\ninterface CandidateCoverageDiagnostics {\n  unseenInTrainCount: number;\n  illegalByCatalogCount: number;\n  truncatedByLimitCount: number;\n  unexplainedCount: number;\n}",
    ),
    (
        "      const signatureCounts = await collectSignatures(\n        this.sourceDataset,\n        trainIds,\n        (count) => {\n          this.status = { ...this.status, processedRowCount: count };\n        },\n      );\n      const archetypes = buildArchetypes(signatureCounts, options);",
        "      const preparation = await collectTrainingPreparation(\n        this.sourceDataset,\n        trainIds,\n        (count) => {\n          this.status = { ...this.status, processedRowCount: count };\n        },\n      );\n      const archetypes = buildArchetypes(preparation.signatureCounts, options);",
    ),
    (
        "      const catalog = await this.loadCatalog();\n      const model = createModel();",
        "      const catalog = await this.loadCatalog();\n      const model = createModel(preparation.globalActionCounts);",
    ),
    (
        "      let coveredRows = 0;\n      let passRows = 0;",
        "      let coveredRows = 0;\n      const coverageDiagnostics: CandidateCoverageDiagnostics = {\n        unseenInTrainCount: 0,\n        illegalByCatalogCount: 0,\n        truncatedByLimitCount: 0,\n        unexplainedCount: 0,\n      };\n      let passRows = 0;",
    ),
    (
        "            const candidates = candidateShortlist(\n              prepared,\n              model,\n              catalog,\n              options.candidateLimit,\n            );\n            const covered = candidates.includes(prepared.target.actionKey);\n            coveredRows += covered ? 1 : 0;\n            await candidateWriter.write({\n              schemaVersion: SCHEMA_VERSION,\n              decisionId: prepared.decisionId,\n              candidateActionKeys: candidates,\n              actualActionKey: prepared.target.actionKey,\n              actualActionCovered: covered,\n            });",
        "            const candidateSelection = candidateShortlist(\n              prepared,\n              model,\n              catalog,\n              options.candidateLimit,\n            );\n            const candidates = candidateSelection.actions;\n            const covered = candidates.includes(prepared.target.actionKey);\n            coveredRows += covered ? 1 : 0;\n            if (!covered) {\n              if (!candidateSelection.actualActionObservedInTrain) {\n                coverageDiagnostics.unseenInTrainCount += 1;\n              } else if (!candidateSelection.actualActionLegal) {\n                coverageDiagnostics.illegalByCatalogCount += 1;\n              } else if (candidateSelection.actualActionRankBeforeLimit >= options.candidateLimit) {\n                coverageDiagnostics.truncatedByLimitCount += 1;\n              } else {\n                coverageDiagnostics.unexplainedCount += 1;\n              }\n            }\n            await candidateWriter.write({\n              schemaVersion: SCHEMA_VERSION,\n              decisionId: prepared.decisionId,\n              candidateActionKeys: candidates,\n              actualActionKey: prepared.target.actionKey,\n              actualActionCovered: covered,\n              actualActionObservedInTrain: candidateSelection.actualActionObservedInTrain,\n              actualActionLegal: candidateSelection.actualActionLegal,\n              actualActionRankBeforeLimit: candidateSelection.actualActionRankBeforeLimit,\n            });",
    ),
    (
        "        coveredRows,\n        options,",
        "        coveredRows,\n        coverageDiagnostics,\n        options,",
    ),
    (
        "        modelVersion: 'CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_1',",
        "        modelVersion: 'CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_2',",
    ),
    (
        "        candidateSetPolicy: 'TRAIN_OBSERVED_LEGAL_SHORTLIST',",
        "        candidateSetPolicy: 'TRAIN_OBSERVED_GLOBAL_BACKOFF_LEGAL_SHORTLIST',",
    ),
    (
        "          heroPhaseBase: 1,",
        "          heroPhaseBase: 1,",
    ),
    (
        "          coverageRate: divide(coveredRows, validationRows),\n        },",
        "          coverageRate: divide(coveredRows, validationRows),\n          diagnostics: { ...coverageDiagnostics },\n        },",
    ),
    (
        "async function collectSignatures(\n  path: string,\n  trainIds: ReadonlySet<number>,\n  progress: (count: number) => void,\n): Promise<Map<number, Map<string, number>>> {\n  const result = new Map<number, Map<string, number>>();",
        "async function collectTrainingPreparation(\n  path: string,\n  trainIds: ReadonlySet<number>,\n  progress: (count: number) => void,\n): Promise<{\n  signatureCounts: Map<number, Map<string, number>>;\n  globalActionCounts: CountMap;\n}> {\n  const signatureCounts = new Map<number, Map<string, number>>();\n  const globalActionCounts: CountMap = new Map();",
    ),
    (
        "    const counts = result.get(heroId) ?? new Map<string, number>();\n    counts.set(signature, (counts.get(signature) ?? 0) + 1);\n    result.set(heroId, counts);",
        "    const counts = signatureCounts.get(heroId) ?? new Map<string, number>();\n    counts.set(signature, (counts.get(signature) ?? 0) + 1);\n    signatureCounts.set(heroId, counts);",
    ),
    (
        "    if (trainIds.has(row.matchId)) {\n      const nextKey = `${row.matchId}:${row.playerId}`;",
        "    if (trainIds.has(row.matchId)) {\n      globalActionCounts.set(\n        row.actualActionKey,\n        (globalActionCounts.get(row.actualActionKey) ?? 0) + 1,\n      );\n      const nextKey = `${row.matchId}:${row.playerId}`;",
    ),
    (
        "  return result;\n}\n\nfunction buildArchetypes(",
        "  return { signatureCounts, globalActionCounts };\n}\n\nfunction buildArchetypes(",
    ),
    (
        "function createModel(): Model {\n  return {\n    hero: new Map(),",
        "function createModel(globalActionCounts: CountMap): Model {\n  return {\n    global: new Map(globalActionCounts),\n    hero: new Map(),",
    ),
    (
        "function candidateShortlist(\n  row: PreparedRow,\n  model: Model,\n  catalog: ContextualV3CandidateCatalog,\n  limit: number,\n): string[] {\n  const phaseKey = `${row.features.heroId}|${row.features.phase}`;\n  const counts = mergeCounts(\n    model.heroPhase.get(phaseKey),\n    model.hero.get(String(row.features.heroId)),\n  );\n  const inventory = parseInventoryItemIds(row.features.inventoryBeforeStateKey);\n  return [...counts]\n    .filter(([action]) => isLegalCandidateAction(action, inventory, catalog))\n    .sort(([aKey, aCount], [bKey, bCount]) => bCount - aCount || aKey.localeCompare(bKey))\n    .slice(0, limit)\n    .map(([action]) => action);\n}",
        "function candidateShortlist(\n  row: PreparedRow,\n  model: Model,\n  catalog: ContextualV3CandidateCatalog,\n  limit: number,\n): CandidateSelection {\n  const phaseKey = `${row.features.heroId}|${row.features.phase}`;\n  const inventory = parseInventoryItemIds(row.features.inventoryBeforeStateKey);\n  const actions = selectLegalCandidateActions(\n    model.heroPhase.get(phaseKey),\n    model.hero.get(String(row.features.heroId)),\n    model.global,\n    inventory,\n    catalog,\n  );\n  return {\n    actions: actions.slice(0, limit),\n    actualActionObservedInTrain: model.global.has(row.target.actionKey),\n    actualActionLegal: isLegalCandidateAction(row.target.actionKey, inventory, catalog),\n    actualActionRankBeforeLimit: actions.indexOf(row.target.actionKey),\n  };\n}\n\nexport function selectLegalCandidateActions(\n  phaseCounts: ReadonlyMap<string, number> | undefined,\n  heroCounts: ReadonlyMap<string, number> | undefined,\n  globalCounts: ReadonlyMap<string, number>,\n  inventory: ReadonlySet<number>,\n  catalog: ContextualV3CandidateCatalog,\n): string[] {\n  const actionKeys = new Set<string>([\n    ...globalCounts.keys(),\n    ...(heroCounts?.keys() ?? []),\n    ...(phaseCounts?.keys() ?? []),\n  ]);\n  return [...actionKeys]\n    .filter((action) => isLegalCandidateAction(action, inventory, catalog))\n    .sort(\n      (left, right) =>\n        (phaseCounts?.get(right) ?? 0) - (phaseCounts?.get(left) ?? 0) ||\n        (heroCounts?.get(right) ?? 0) - (heroCounts?.get(left) ?? 0) ||\n        (globalCounts.get(right) ?? 0) - (globalCounts.get(left) ?? 0) ||\n        left.localeCompare(right),\n    );\n}",
    ),
    (
        "  coveredRows: number,\n  options: TrainingOptions,",
        "  coveredRows: number,\n  coverageDiagnostics: CandidateCoverageDiagnostics,\n  options: TrainingOptions,",
    ),
    (
        "    candidateSetPolicy: 'TRAIN_OBSERVED_LEGAL_SHORTLIST',",
        "    candidateSetPolicy: 'TRAIN_OBSERVED_GLOBAL_BACKOFF_LEGAL_SHORTLIST',",
    ),
    (
        "    candidateCoverageRate: coverage,\n    baseline,",
        "    candidateCoverageRate: coverage,\n    candidateCoverageDiagnostics: { ...coverageDiagnostics },\n    baseline,",
    ),
    (
        "    pipelineVersion: 'CONTEXTUAL_V3_TRAINING_PIPELINE_1',",
        "    pipelineVersion: 'CONTEXTUAL_V3_TRAINING_PIPELINE_2',",
    ),
    (
        "function serializeModel(model: Model): Record<string, unknown> {\n  return {\n    hero: serializeTable(model.hero),",
        "function serializeModel(model: Model): Record<string, unknown> {\n  return {\n    global: Object.fromEntries(\n      [...model.global].sort(([a], [b]) => a.localeCompare(b)),\n    ),\n    hero: serializeTable(model.hero),",
    ),
    (
        "    candidateLimit: boundedInteger(request.candidateLimit, 64, 5, 256, 'candidateLimit'),",
        "    candidateLimit: boundedInteger(request.candidateLimit, 128, 5, 256, 'candidateLimit'),",
    ),
]

for old, new in replacements:
    if old not in service:
        raise RuntimeError(f'Expected service fragment was not found:\n{old[:200]}')
    service = service.replace(old, new, 1)

# The policy string appears in both model and evaluation. Ensure no stale policy remains.
service = service.replace(
    "'TRAIN_OBSERVED_LEGAL_SHORTLIST'",
    "'TRAIN_OBSERVED_GLOBAL_BACKOFF_LEGAL_SHORTLIST'",
)

# mergeCounts is no longer used after deterministic three-level candidate ordering.
old_merge = """function mergeCounts(primary?: CountMap, secondary?: CountMap): CountMap {
  const result = new Map<string, number>();
  for (const [key, count] of secondary ?? []) result.set(key, count);
  for (const [key, count] of primary ?? []) {
    result.set(key, (result.get(key) ?? 0) + count * 2);
  }
  return result;
}

"""
if old_merge not in service:
    raise RuntimeError('Expected mergeCounts helper was not found')
service = service.replace(old_merge, '', 1)
service_path.write_text(service)

spec_path = Path('apps/api/test/hero-build-contextual-v3-training.spec.ts')
spec = spec_path.read_text()
spec = spec.replace(
    '  selectChronologicalSplit,\n',
    '  selectChronologicalSplit,\n  selectLegalCandidateActions,\n',
)
insert = """

  it('uses global train observations as a deterministic candidate backoff', () => {
    const catalog = {
      itemIds: new Set([100, 200, 300, 400]),
      componentsByParent: new Map<number, Set<number>>(),
    };
    const actions = selectLegalCandidateActions(
      new Map([['BUY:100', 10]]),
      new Map([['BUY:200', 20]]),
      new Map([
        ['BUY:300', 1000],
        ['BUY:400', 500],
      ]),
      new Set(),
      catalog,
    );

    expect(actions).toEqual(['BUY:100', 'BUY:200', 'BUY:300', 'BUY:400']);
  });
"""
marker = "\n  it('requires every direct component before admitting an upgrade candidate'"
if marker not in spec:
    raise RuntimeError('Expected test insertion marker was not found')
spec = spec.replace(marker, insert + marker, 1)
spec = spec.replace("\n\n\n  it('requires", "\n\n  it('requires")
spec_path.write_text(spec)

doc_path = Path('docs/contextual-v3-training.md')
doc = doc_path.read_text()
doc = doc.replace(
    'Validation uses a train-observed shortlist with a configurable maximum size.',
    'Validation uses a train-observed shortlist with hero-phase, hero, and global train-only backoff plus a configurable maximum size.',
)
doc = doc.replace(
    '- `UPGRADE` candidates require a directly owned recipe component;',
    '- `UPGRADE` candidates require every direct recipe component to be owned;',
)
doc = doc.replace(
    'Candidate coverage is reported explicitly and is part of the release gate.',
    'Candidate coverage is reported explicitly and is part of the release gate. Uncovered decisions are classified as unseen in train, rejected by catalog legality, truncated by the shortlist limit, or unexplained.',
)
doc = doc.replace('"candidateLimit": 64', '"candidateLimit": 128')
doc_path.write_text(doc)
