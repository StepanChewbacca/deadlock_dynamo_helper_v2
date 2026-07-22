from pathlib import Path

service_path = Path('apps/api/src/deadlock-live/hero-build-contextual-v3-training.service.ts')
service = service_path.read_text()

service = service.replace(
    "interface Catalog {\n  itemIds: Set<number>;\n  componentsByParent: Map<number, Set<number>>;\n}",
    "export interface ContextualV3CandidateCatalog {\n  itemIds: ReadonlySet<number>;\n  componentsByParent: ReadonlyMap<number, ReadonlySet<number>>;\n}",
)

old_start = """  async start(
    request: ContextualV3TrainingStartRequest = {},
  ): Promise<ContextualV3TrainingStatus> {
    if (this.status.state === 'RUNNING') {
      throw new Error('Contextual V3 training pipeline is already running.');
    }
    const options = normalizeOptions(request, this.defaultExpectedSha);
    await mkdir(this.outputDir, { recursive: true });
    await this.clearOutputs();
    this.manifest = undefined;
    this.audit = undefined;
    this.evaluation = undefined;
    this.archetypes = undefined;
    this.status = {
      ...this.idleStatus(),
      state: 'RUNNING',
      startedAt: new Date().toISOString(),
      options,
    };
    void this.run(options);
    return this.getStatus();
  }"""
new_start = """  async start(
    request: ContextualV3TrainingStartRequest = {},
  ): Promise<ContextualV3TrainingStatus> {
    if (this.status.state === 'RUNNING') {
      throw new Error('Contextual V3 training pipeline is already running.');
    }
    const options = normalizeOptions(request, this.defaultExpectedSha);
    this.status = {
      ...this.idleStatus(),
      state: 'RUNNING',
      startedAt: new Date().toISOString(),
      options,
      manifestAvailable: this.manifest !== undefined,
      auditAvailable: this.audit !== undefined,
      evaluationAvailable: this.evaluation !== undefined,
      modelAvailable: this.manifest !== undefined,
    };
    void this.run(options);
    return this.getStatus();
  }"""
if old_start not in service:
    raise RuntimeError('Expected start implementation was not found')
service = service.replace(old_start, new_start)

preflight_marker = """      if (sourceManifest.artifact.sha256 !== actualSha) {
        throw new Error('Source manifest SHA-256 does not match dataset.ndjson.');
      }

      this.status = {"""
preflight_replacement = """      if (sourceManifest.artifact.sha256 !== actualSha) {
        throw new Error('Source manifest SHA-256 does not match dataset.ndjson.');
      }

      await mkdir(this.outputDir, { recursive: true });
      await this.clearOutputs();
      this.manifest = undefined;
      this.audit = undefined;
      this.evaluation = undefined;
      this.archetypes = undefined;
      this.status = {
        ...this.status,
        manifestAvailable: false,
        auditAvailable: false,
        evaluationAvailable: false,
        modelAvailable: false,
      };

      this.status = {"""
if preflight_marker not in service:
    raise RuntimeError('Expected preflight marker was not found')
service = service.replace(preflight_marker, preflight_replacement)

service = service.replace(
    '  private async loadCatalog(): Promise<Catalog> {',
    '  private async loadCatalog(): Promise<ContextualV3CandidateCatalog> {',
)
service = service.replace(
    '  catalog: Catalog,\n  limit: number,',
    '  catalog: ContextualV3CandidateCatalog,\n  limit: number,',
)
service = service.replace(
    '.filter(([action]) => legalAction(action, inventory, catalog))',
    '.filter(([action]) => isLegalCandidateAction(action, inventory, catalog))',
)
old_legal = "function legalAction(actionKey: string, inventory: ReadonlySet<number>, catalog: Catalog): boolean {"
new_legal = """export function isLegalCandidateAction(
  actionKey: string,
  inventory: ReadonlySet<number>,
  catalog: ContextualV3CandidateCatalog,
): boolean {"""
if old_legal not in service:
    raise RuntimeError('Expected legal-action helper was not found')
service = service.replace(old_legal, new_legal)
service = service.replace(
    '    return Boolean(components && [...components].some((id) => inventory.has(id)));',
    """    return Boolean(
      components &&
        components.size > 0 &&
        [...components].every((id) => inventory.has(id)),
    );""",
)
service_path.write_text(service)

spec_path = Path('apps/api/test/hero-build-contextual-v3-training.spec.ts')
spec = spec_path.read_text()
if 'isLegalCandidateAction,' not in spec:
    spec = spec.replace(
        '  deriveArchetypeSignature,\n',
        '  deriveArchetypeSignature,\n  isLegalCandidateAction,\n',
    )

test_block = """

  it('requires every direct component before admitting an upgrade candidate', () => {
    const catalog = {
      itemIds: new Set([100, 200, 300]),
      componentsByParent: new Map([[300, new Set([100, 200])]]),
    };

    expect(isLegalCandidateAction('UPGRADE:300', new Set([100]), catalog)).toBe(
      false,
    );
    expect(
      isLegalCandidateAction('UPGRADE:300', new Set([100, 200]), catalog),
    ).toBe(true);
  });
"""
if "requires every direct component" not in spec:
    spec = spec.replace(
        "\n  it('parses canonical inventory state keys'",
        test_block + "\n  it('parses canonical inventory state keys'",
    )
spec_path.write_text(spec)
