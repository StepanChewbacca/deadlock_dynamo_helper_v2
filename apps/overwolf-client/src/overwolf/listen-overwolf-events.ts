import { OverwolfLiveEventDto } from '@deadlock-live-probe/shared';
import { DiagnosticCapture } from '../diagnostics/diagnostic-capture';
import { parseJsonSafely } from './parse-json-safely';

export type EventCallback = (event: OverwolfLiveEventDto) => void;

const INVENTORY_SAFETY_POLL_INTERVAL_MS = 15_000;

let diagnosticCapture: DiagnosticCapture | undefined;
let inventorySafetyTimer: ReturnType<typeof setInterval> | undefined;

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

  startInventorySafetyPolling(onEvent, capture);
}

function startInventorySafetyPolling(
  onEvent: EventCallback,
  capture: DiagnosticCapture,
): void {
  const eventsApi = overwolf.games.events as any;
  if (
    inventorySafetyTimer ||
    typeof eventsApi.getInfo !== 'function'
  ) {
    return;
  }

  inventorySafetyTimer = setInterval(() => {
    eventsApi.getInfo((result: any) => {
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
          'inventory_safety_poll',
          onEvent,
          capture,
          true,
        );
      } catch (err) {
        console.error('Error handling inventory safety snapshot:', err);
      }
    });
  }, INVENTORY_SAFETY_POLL_INTERVAL_MS);
}

function emitInfoEntries(
  info: unknown,
  feature: string | undefined,
  onEvent: EventCallback,
  capture: DiagnosticCapture,
  inventoryOnly: boolean,
): void {
  if (!info || typeof info !== 'object') {
    return;
  }

  for (const [category, categoryData] of Object.entries(info)) {
    if (!categoryData || typeof categoryData !== 'object') {
      continue;
    }

    for (const [key, rawValue] of Object.entries(categoryData)) {
      if (inventoryOnly && !key.startsWith('items')) {
        continue;
      }

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
