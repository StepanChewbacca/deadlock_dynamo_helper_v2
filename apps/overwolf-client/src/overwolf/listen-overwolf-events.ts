import { OverwolfLiveEventDto } from '@deadlock-live-probe/shared';
import { DiagnosticCapture } from '../diagnostics/diagnostic-capture';
import { parseJsonSafely } from './parse-json-safely';

export type EventCallback = (event: OverwolfLiveEventDto) => void;

const STATE_SAFETY_POLL_INTERVAL_MS = 3_000;
const STATE_SAFETY_CATEGORIES = new Set([
  'match_info',
  'game_info',
  'roster',
  'items',
]);

let diagnosticCapture: DiagnosticCapture | undefined;
let stateSafetyTimer: ReturnType<typeof setInterval> | undefined;
let stateSafetyPollInFlight = false;

export function listenOverwolfEvents(onEvent: EventCallback): void {
  if (typeof overwolf === 'undefined' || !overwolf.games || !overwolf.games.events) {
    console.warn('Overwolf API is not available; events listener registration skipped.');
    return;
  }

  diagnosticCapture ??= new DiagnosticCapture(`capture-${Math.random().toString(36).slice(2, 10)}`);
  const capture = diagnosticCapture;
  capture.initialize(overwolf);

  overwolf.games.events.onInfoUpdates2.addListener((infoUpdate: any) => {
    try {
      emitInfoEntries(
        infoUpdate?.info,
        infoUpdate?.feature,
        onEvent,
        capture,
        false,
      );
    } catch (err) {
      console.error('Error handling onInfoUpdates2 event:', err);
    }
  });

  overwolf.games.events.onNewEvents.addListener((eventsEvent: any) => {
    try {
      const { events, feature } = eventsEvent;
      if (!Array.isArray(events)) {
        return;
      }

      for (const e of events) {
        if (!e || typeof e !== 'object') {
          continue;
        }

        const receivedAt = Date.now();
        capture.captureRaw({
          receivedAt,
          source: 'onNewEvents',
          feature,
          key: e.name,
          rawPayload: e.data,
        });
        const parsedData = parseJsonSafely(e.data);

        onEvent({
          receivedAt,
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

  startStateSafetyPolling(onEvent, capture);
}

function startStateSafetyPolling(
  onEvent: EventCallback,
  capture: DiagnosticCapture,
): void {
  const eventsApi = overwolf.games.events as any;
  if (stateSafetyTimer || typeof eventsApi.getInfo !== 'function') {
    return;
  }

  const reconcileCurrentState = (): void => {
    if (stateSafetyPollInFlight) {
      return;
    }

    stateSafetyPollInFlight = true;
    eventsApi.getInfo((result: any) => {
      stateSafetyPollInFlight = false;
      try {
        if (
          !result ||
          (result.success !== true && result.status !== 'success') ||
          !result.res
        ) {
          return;
        }

        emitInfoEntries(
          result.res,
          'state_safety_poll',
          onEvent,
          capture,
          true,
        );
      } catch (err) {
        console.error('Error handling live state safety snapshot:', err);
      }
    });
  };

  stateSafetyTimer = setInterval(
    reconcileCurrentState,
    STATE_SAFETY_POLL_INTERVAL_MS,
  );
  reconcileCurrentState();
}

function emitInfoEntries(
  info: unknown,
  feature: string | undefined,
  onEvent: EventCallback,
  capture: DiagnosticCapture,
  stateSafetyOnly: boolean,
): void {
  if (!info || typeof info !== 'object') {
    return;
  }

  for (const [category, categoryData] of Object.entries(info)) {
    if (!categoryData || typeof categoryData !== 'object') {
      continue;
    }

    if (stateSafetyOnly && !STATE_SAFETY_CATEGORIES.has(category)) {
      continue;
    }

    for (const [key, rawValue] of Object.entries(categoryData)) {
      const receivedAt = Date.now();
      capture.captureRaw({
        receivedAt,
        source: 'onInfoUpdates2',
        feature,
        category,
        key,
        rawPayload: rawValue,
      });
      const parsedValue = parseJsonSafely(rawValue);

      onEvent({
        receivedAt,
        source: 'onInfoUpdates2',
        feature,
        category,
        key,
        payload: parsedValue,
      });
    }
  }
}
