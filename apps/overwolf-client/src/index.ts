import { LiveEventBuffer } from './overwolf/live-event-buffer';
import { setRequiredFeatures } from './overwolf/set-required-features';
import { listenOverwolfEvents } from './overwolf/listen-overwolf-events';
import * as ui from './ui';

const clientId = `client-${Math.random().toString(36).substring(2, 8)}`;
const apiBaseUrl = 'http://localhost:3000';

ui.logConsole(`Initializing Live Probe client for clientId: ${clientId}`);

// Custom fetch wrapper to count sends and update status indicator in the UI
const customFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  try {
    const res = await fetch(url, init);
    if (res.ok) {
      ui.incrementSends();
      ui.updateIndicator('NestJS API connected & sending', true);
    } else {
      ui.logConsole(`Ingest error: HTTP ${res.status}`);
      ui.updateIndicator(`Ingest error: HTTP ${res.status}`, false);
    }
    return res;
  } catch (err: any) {
    ui.logConsole(`Network error: ${err.message || err}`);
    ui.updateIndicator('NestJS API offline', false);
    throw err;
  }
};

const buffer = new LiveEventBuffer(clientId, apiBaseUrl, customFetch, 1000);

async function start() {
  try {
    ui.updateStatus('REGISTERING...', 'init');
    await setRequiredFeatures();
    ui.updateStatus('REGISTERED', 'connected');
    ui.logConsole('Successfully registered GEP required features: game_info, match_info');

    listenOverwolfEvents((event) => {
      // Extract details for last-event preview
      const eventDetails = `Source: ${event.source} | Key: ${event.key || 'n/a'} | Cat: ${event.category || 'n/a'}`;
      ui.updateLastEvent(eventDetails);
      ui.logConsole(`GEP Event: ${JSON.stringify(event)}`);

      // Push to buffering queue
      buffer.push(event);
    });
  } catch (err: any) {
    ui.updateStatus('FAILED', 'error');
    ui.logConsole(`GEP feature registration failed: ${err.message}`);
  }
}

// Start client runtime
start();
