import { Injectable } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { OverwolfLiveEventDto } from '@deadlock-live-probe/shared';

@Injectable()
export class RawEventLogService {
  private readonly baseDir = join(process.cwd(), 'storage', 'deadlock-live');

  async appendEvents(events: OverwolfLiveEventDto[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await mkdir(this.baseDir, { recursive: true });

    const eventsByMatchId = new Map<string, OverwolfLiveEventDto[]>();

    for (const event of events) {
      const matchId = event.matchId ?? 'unknown';
      const existingEvents = eventsByMatchId.get(matchId);

      if (existingEvents) {
        existingEvents.push(event);
        continue;
      }

      eventsByMatchId.set(matchId, [event]);
    }

    await Promise.all(
      [...eventsByMatchId.entries()].map(([matchId, matchEvents]) =>
        appendFile(
          join(this.baseDir, `${matchId}.ndjson`),
          matchEvents.map((event) => `${JSON.stringify(event)}\n`).join(''),
          'utf8',
        ),
      ),
    );
  }
}
