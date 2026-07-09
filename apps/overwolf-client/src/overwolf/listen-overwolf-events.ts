import { OverwolfLiveEventDto } from '@deadlock-live-probe/shared';
import { parseJsonSafely } from './parse-json-safely';

export type EventCallback = (event: OverwolfLiveEventDto) => void;

export function listenOverwolfEvents(onEvent: EventCallback): void {
  if (typeof overwolf === 'undefined' || !overwolf.games || !overwolf.games.events) {
    console.warn('Overwolf API is not available; events listener registration skipped.');
    return;
  }

  overwolf.games.events.onInfoUpdates2.addListener((infoUpdate) => {
    try {
      const { info, feature } = infoUpdate;
      if (!info || typeof info !== 'object') {
        return;
      }

      // Iterate through categories (e.g., match_info, roster, items)
      for (const [category, categoryData] of Object.entries(info)) {
        if (!categoryData || typeof categoryData !== 'object') {
          continue;
        }

        // Iterate through key-values inside category
        for (const [key, rawValue] of Object.entries(categoryData)) {
          const parsedValue = parseJsonSafely(rawValue);
          
          onEvent({
            receivedAt: Date.now(),
            source: 'onInfoUpdates2',
            feature,
            category,
            key,
            payload: parsedValue,
          });
        }
      }
    } catch (err) {
      console.error('Error handling onInfoUpdates2 event:', err);
    }
  });

  overwolf.games.events.onNewEvents.addListener((eventsEvent) => {
    try {
      const { events, feature } = eventsEvent;
      if (!Array.isArray(events)) {
        return;
      }

      for (const e of events) {
        if (!e || typeof e !== 'object') {
          continue;
        }

        const parsedData = parseJsonSafely(e.data);

        onEvent({
          receivedAt: Date.now(),
          source: 'onNewEvents',
          feature,
          key: e.name,
          payload: parsedData,
        });
      }
    } catch (err) {
      console.error('Error handling onNewEvents event:', err);
    }
  });
}
