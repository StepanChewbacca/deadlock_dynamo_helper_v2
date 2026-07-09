import { OverwolfLiveBatchDto, OverwolfLiveEventDto } from '@deadlock-live-probe/shared';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class LiveEventBuffer {
  private readonly events: OverwolfLiveEventDto[] = [];
  private timerId?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly clientId: string,
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly flushDelayMs = 1000,
  ) {}

  push(event: OverwolfLiveEventDto): void {
    this.events.push(event);

    if (this.timerId) {
      return;
    }

    this.timerId = setTimeout(() => {
      void this.flush();
    }, this.flushDelayMs);
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
