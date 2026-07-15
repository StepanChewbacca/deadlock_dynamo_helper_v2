import { OverwolfLiveBatchDto, OverwolfLiveEventDto } from '@deadlock-live-probe/shared';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type MatchIdProvider = () => string | undefined;

export class LiveEventBuffer {
  private readonly events: OverwolfLiveEventDto[] = [];
  private timerId?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly clientId: string,
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly flushDelayMs = 1000,
    private readonly matchIdProvider: MatchIdProvider = readCurrentMatchId,
  ) {}

  push(event: OverwolfLiveEventDto): void {
    const providedMatchId = this.matchIdProvider()?.trim();
    const eventMatchId = event.matchId?.trim();
    const matchId = eventMatchId || providedMatchId;

    this.events.push(matchId ? { ...event, matchId } : event);

    if (isImmediateEvent(event)) {
      this.scheduleFlush(0, true);
      return;
    }

    this.scheduleFlush(this.flushDelayMs, false);
  }

  private scheduleFlush(delayMs: number, replaceExisting: boolean): void {
    if (this.timerId) {
      if (!replaceExisting) {
        return;
      }
      clearTimeout(this.timerId);
      this.timerId = undefined;
    }

    this.timerId = setTimeout(() => {
      void this.flush();
    }, delayMs);
  }

  private async flush(): Promise<void> {
    const events = this.events.splice(0);
    this.timerId = undefined;

    if (events.length === 0) {
      return;
    }

    const body: OverwolfLiveBatchDto = {
      clientId: this.clientId,
      events,
    };

    try {
      await this.fetchImpl(`${this.apiBaseUrl}/deadlock/live/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error('Failed to flush event batch:', err);
    }
  }
}

function isImmediateEvent(event: OverwolfLiveEventDto): boolean {
  return (
    event.feature === 'state_safety_poll' ||
    (typeof event.key === 'string' && event.key.startsWith('items'))
  );
}

function readCurrentMatchId(): string | undefined {
  const globalMatchId = (globalThis as any).__deadlockLiveMatchId;
  if (typeof globalMatchId === 'string' && globalMatchId.trim()) {
    return globalMatchId.trim();
  }

  try {
    const ow = (globalThis as any).overwolf;
    const mainWindow = ow?.windows?.getMainWindow?.();
    const mainWindowMatchId = mainWindow?.__deadlockLiveMatchId;
    return typeof mainWindowMatchId === 'string' && mainWindowMatchId.trim()
      ? mainWindowMatchId.trim()
      : undefined;
  } catch {
    return undefined;
  }
}
