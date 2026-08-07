from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one patch anchor, found {count}')
    path.write_text(text.replace(old, new, 1))


crawler = Path('apps/api/src/deadlock-live/recent-match-crawler.service.ts')
replace_once(
    crawler,
    """  private readonly hasApiKey = Boolean(process.env.DEADLOCK_API_KEY?.trim());

  private isCrawling = false;""",
    """  private readonly hasApiKey = Boolean(process.env.DEADLOCK_API_KEY?.trim());
  private readonly enabled =
    process.env.DEADLOCK_RECENT_MATCH_CRAWLER_ENABLED?.trim().toLowerCase() !==
    'false';

  private isCrawling = false;""",
)
replace_once(
    crawler,
    """  async onModuleInit(): Promise<void> {
    await this.recoverCrawlerStateAfterRestart();""",
    """  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Recent match crawler is disabled for this runtime.');
      return;
    }
    await this.recoverCrawlerStateAfterRestart();""",
)
replace_once(
    crawler,
    """  async startCrawling(): Promise<void> {
    if (this.isCrawling) {""",
    """  async startCrawling(): Promise<void> {
    if (!this.enabled || this.isCrawling) {""",
)
replace_once(
    crawler,
    """  async scheduledCrawl(): Promise<void> {
    this.logger.log('Starting scheduled four-hour crawl for the two-week match window.');""",
    """  async scheduledCrawl(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    this.logger.log('Starting scheduled four-hour crawl for the two-week match window.');""",
)

reference_data = Path(
    'apps/api/src/deadlock-live/reference-data-import.service.ts'
)
replace_once(
    reference_data,
    """export class ReferenceDataImportService implements OnModuleInit {
  private readonly logger = new Logger(ReferenceDataImportService.name);

  constructor(""",
    """export class ReferenceDataImportService implements OnModuleInit {
  private readonly logger = new Logger(ReferenceDataImportService.name);
  private readonly enabled =
    process.env.DEADLOCK_REFERENCE_DATA_IMPORT_ENABLED?.trim().toLowerCase() !==
    'false';

  constructor(""",
)
replace_once(
    reference_data,
    """  async onModuleInit() {
    await this.importIfNeeded();
  }""",
    """  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Reference data import is disabled for this runtime.');
      return;
    }
    await this.importIfNeeded();
  }""",
)

outcome_linker = Path(
    'apps/api/src/deadlock-live/recommendation-outcome-linker.service.ts'
)
replace_once(
    outcome_linker,
    """  private running = false;

  constructor(""",
    """  private readonly enabled =
    process.env.DEADLOCK_RECOMMENDATION_OUTCOME_LINKER_ENABLED?.trim().toLowerCase() !==
    'false';
  private running = false;

  constructor(""",
)
replace_once(
    outcome_linker,
    """  onModuleInit(): void {
    void this.linkPendingOutcomes();
  }""",
    """  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Recommendation outcome linker is disabled for this runtime.');
      return;
    }
    void this.linkPendingOutcomes();
  }""",
)
replace_once(
    outcome_linker,
    """  async linkPendingOutcomes(): Promise<void> {
    if (this.running) {""",
    """  async linkPendingOutcomes(): Promise<void> {
    if (!this.enabled || this.running) {""",
)

recipe_service = Path(
    'apps/api/src/deadlock-live/recipe-aware-timeline-reconciliation.service.ts'
)
replace_once(
    recipe_service,
    """  private readonly logger = new Logger(RecipeAwareTimelineReconciliationService.name);
  private componentItemIdsByParent = new Map<number, readonly number[]>();""",
    """  private readonly logger = new Logger(RecipeAwareTimelineReconciliationService.name);
  private readonly intervalRefreshEnabled =
    process.env.DEADLOCK_TIMELINE_RECIPE_REFRESH_ENABLED?.trim().toLowerCase() !==
    'false';
  private componentItemIdsByParent = new Map<number, readonly number[]>();""",
)
replace_once(
    recipe_service,
    """  refreshOnInterval(): void {
    void this.refreshRecipes().catch((error) => {""",
    """  refreshOnInterval(): void {
    if (!this.intervalRefreshEnabled) {
      return;
    }
    void this.refreshRecipes().catch((error) => {""",
)

for workflow_path in [
    Path('.github/workflows/recommendation-v8-replay-audit-recovery-v2.yml'),
    Path('.github/workflows/recommendation-v8-replay-recovery-resume-v3.yml'),
]:
    replace_once(
        workflow_path,
        """-e DEADLOCK_TIMELINE_COLLECTOR_ENABLED=false -e DEADLOCK_CONTEXTUAL_SHADOW_ENABLED=false""",
        """-e DEADLOCK_TIMELINE_COLLECTOR_ENABLED=false -e DEADLOCK_RECENT_MATCH_CRAWLER_ENABLED=false -e DEADLOCK_REFERENCE_DATA_IMPORT_ENABLED=false -e DEADLOCK_RECOMMENDATION_OUTCOME_LINKER_ENABLED=false -e DEADLOCK_TIMELINE_RECIPE_REFRESH_ENABLED=false -e DEADLOCK_CONTEXTUAL_SHADOW_ENABLED=false""",
    )
