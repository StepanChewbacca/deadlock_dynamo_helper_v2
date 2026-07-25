import {
  createObjectiveEvent,
  createPlayerSnapshot,
  extractActiveMatchIds,
  MATCH_TIMELINE_SCHEMA_VERSION,
  MATCH_TIMELINE_VERSION,
  parseSseStream,
  type MatchTimelineRawEvent,
} from '../src/deadlock-live/match-timeline-collector.service';

describe('match timeline collector helpers', () => {
  it('extracts unique active match IDs from changing response envelopes', () => {
    expect(
      extractActiveMatchIds({
        matches: [
          { match_id: 12 },
          { matchId: 13 },
          { nested: { match_id: '12' } },
          { match_id: 0 },
        ],
      }),
    ).toEqual([13, 12]);
  });

  it('parses named SSE events across arbitrary chunks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: player_controller_entity_updated\ndata: {"game_time":10,',
          ),
        );
        controller.enqueue(
          encoder.encode(
            '"entity_type":"player_controller"}\n\nevent: end\ndata: {}\n\n',
          ),
        );
        controller.close();
      },
    });
    const messages: Array<{ eventName: string; data: string }> = [];

    await parseSseStream(stream, async (message) => {
      messages.push(message);
    });

    expect(messages).toEqual([
      {
        eventName: 'player_controller_entity_updated',
        data: '{"game_time":10,"entity_type":"player_controller"}',
      },
      { eventName: 'end', data: '{}' },
    ]);
  });

  it('normalizes player and objective timeline events', () => {
    const playerEvent = createRawEvent({
      eventName: 'player_controller_entity_updated',
      gameTimeS: 245.6,
      payload: {
        entity_type: 'player_controller',
        event_type: 'entity_update',
        hero_id: 15,
        steam_id: '7656119',
        team: 2,
        kills: 4,
        deaths: 1,
        assists: 7,
        net_worth: 12350,
        hero_damage: 8420,
      },
    });
    expect(createPlayerSnapshot(playerEvent)).toMatchObject({
      matchId: 100,
      gameTimeS: 245.6,
      heroId: 15,
      steamId: '7656119',
      kills: 4,
      deaths: 1,
      assists: 7,
      netWorth: 12350,
      heroDamage: 8420,
    });

    const objectiveEvent = createRawEvent({
      eventName: 'destroyable_building_entity_deleted',
      gameTimeS: 300,
      payload: {
        entity_type: 'destroyable_building',
        event_type: 'entity_delete',
        entity_index: 22,
        team: 3,
      },
    });
    expect(createObjectiveEvent(objectiveEvent)).toMatchObject({
      objectiveType: 'destroyable_building',
      gameTimeS: 300,
      entityIndex: 22,
      teamId: 3,
    });
  });
});

function createRawEvent(input: {
  eventName: string;
  gameTimeS: number;
  payload: Record<string, unknown>;
}): MatchTimelineRawEvent {
  return {
    schemaVersion: MATCH_TIMELINE_SCHEMA_VERSION,
    timelineVersion: MATCH_TIMELINE_VERSION,
    eventId: 'a'.repeat(64),
    matchId: 100,
    sequence: 1,
    receivedAt: '2026-07-25T00:00:00.000Z',
    eventName: input.eventName,
    gameTimeS: input.gameTimeS,
    tick: 10,
    payload: input.payload,
  };
}
