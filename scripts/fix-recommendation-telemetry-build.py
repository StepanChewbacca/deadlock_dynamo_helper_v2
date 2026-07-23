from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

traversal_path = ROOT / 'apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts'
traversal = traversal_path.read_text(encoding='utf-8')

old_request = """        const recommendationRequest: HeroBuildContextualRecommendationRequest = {
          heroId: input.heroId,
          teamId: input.teamId,
          itemIds: [...input.itemIds],
"""
new_request = """        const recommendationRequest: HeroBuildContextualRecommendationRequest = {
          heroId: input.heroId,
          itemIds: [...input.itemIds],
"""
if old_request not in traversal:
    raise SystemExit('Generated recommendation request did not contain the expected teamId insertion.')
traversal = traversal.replace(old_request, new_request, 1)

old_snapshot = """          state: 'READY',
          matchId: input.matchId,
          steamId: input.steamId,
          heroId: input.heroId,
          itemIds: [...input.itemIds],
"""
new_snapshot = """          state: 'READY',
          matchId: input.matchId,
          steamId: input.steamId,
          heroId: input.heroId,
          teamId: input.teamId,
          itemIds: [...input.itemIds],
"""
if old_snapshot not in traversal:
    raise SystemExit('Generated ready snapshot block was not found.')
traversal = traversal.replace(old_snapshot, new_snapshot, 1)
traversal_path.write_text(traversal, encoding='utf-8')

telemetry_path = ROOT / 'apps/api/src/deadlock-live/recommendation-decision-telemetry.service.ts'
telemetry = telemetry_path.read_text(encoding='utf-8')

old_init = """  async onModuleInit(): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
    await this.replayPersistedEvents();
"""
new_init = """  async onModuleInit(): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
    await appendFile(this.eventLogPath, '', 'utf8');
    await this.replayPersistedEvents();
"""
if old_init not in telemetry:
    raise SystemExit('Generated telemetry initialization block was not found.')
telemetry = telemetry.replace(old_init, new_init, 1)

old_wait = """  async waitForIdle(): Promise<void> {
    await this.writeQueue;
  }
"""
new_wait = """  async waitForIdle(): Promise<void> {
    await this.writeQueue;
    if (this.lastWriteError) {
      throw new Error(
        `Recommendation telemetry write failed: ${this.lastWriteError}`,
      );
    }
  }
"""
if old_wait not in telemetry:
    raise SystemExit('Generated telemetry wait block was not found.')
telemetry = telemetry.replace(old_wait, new_wait, 1)

old_append = """    this.writeQueue = this.writeQueue
      .then(() => appendFile(this.eventLogPath, serialized, 'utf8'))
      .catch((error: unknown) => {
"""
new_append = """    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(this.outputDirectory, { recursive: true });
        await appendFile(this.eventLogPath, serialized, 'utf8');
      })
      .catch((error: unknown) => {
"""
if old_append not in telemetry:
    raise SystemExit('Generated telemetry append block was not found.')
telemetry = telemetry.replace(old_append, new_append, 1)
telemetry_path.write_text(telemetry, encoding='utf-8')

test_path = ROOT / 'apps/api/test/recommendation-decision-telemetry.spec.ts'
test_source = test_path.read_text(encoding='utf-8')
old_test_marker = """    const service = new RecommendationDecisionTelemetryService();
    await service.onModuleInit();
    const context = createContext();
"""
new_test_marker = """    const service = new RecommendationDecisionTelemetryService();
    await service.onModuleInit();
    expect(service.getStatus().outputDirectory).toBe(outputDirectory);
    const context = createContext();
"""
if old_test_marker not in test_source:
    raise SystemExit('Generated telemetry test initialization was not found.')
test_source = test_source.replace(old_test_marker, new_test_marker, 1)
test_path.write_text(test_source, encoding='utf-8')

(ROOT / 'scripts/fix-recommendation-telemetry-build.py').unlink(missing_ok=True)
