import { describe, expect, it, vi, type Mock } from 'vitest';

import { subscribeMessageLog } from '../live.js';
import type { HomeAssistant } from '../ha-types.js';
import type { ChatMessage, MeshtasticMessageLogEvent } from '../types.js';

type SubscribeEventsFn = (cb: (event: MeshtasticMessageLogEvent) => void, eventType: string) => Promise<() => void>;

interface FakeConnection {
  subscribeEvents: Mock<SubscribeEventsFn>;
  emit: (event: MeshtasticMessageLogEvent) => void;
  unsubscribe: Mock<() => void>;
}

const makeConnection = (): FakeConnection => {
  let listener: ((event: MeshtasticMessageLogEvent) => void) | undefined;
  const unsubscribe = vi.fn<() => void>();
  const subscribeEvents = vi.fn<SubscribeEventsFn>().mockImplementation((cb) => {
    listener = cb;
    return Promise.resolve(unsubscribe);
  });
  return {
    subscribeEvents,
    unsubscribe,
    emit: (event) => {
      listener?.(event);
    },
  };
};

const makeHass = (conn: FakeConnection): HomeAssistant => ({
  states: {},
  callWS: vi.fn(),
  callService: vi.fn(),
  connection: conn as unknown as HomeAssistant['connection'],
});

describe('subscribeMessageLog', () => {
  it('subscribes to the meshtastic_message_log event', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);
    const cb = vi.fn();
    await subscribeMessageLog(hass, 'meshtastic.ch', cb);

    expect(conn.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(conn.subscribeEvents.mock.calls[0][1]).toBe('meshtastic_message_log');
  });

  it('filters out events for a different entity_id', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);
    const received: ChatMessage[] = [];
    const cb = (msg: ChatMessage) => {
      received.push(msg);
    };
    await subscribeMessageLog(hass, 'meshtastic.ch', cb);

    conn.emit({
      event_type: 'meshtastic_message_log',
      data: { entity_id: 'meshtastic.other', from_name: 'A', message: 'hi' },
    });
    expect(received).toHaveLength(0);

    conn.emit({
      event_type: 'meshtastic_message_log',
      data: { entity_id: 'meshtastic.ch', from_name: 'A', message: 'hi' },
    });
    expect(received).toHaveLength(1);
  });

  it('maps event payload to a ChatMessage with source=live', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);
    const received: ChatMessage[] = [];
    const cb = (msg: ChatMessage) => {
      received.push(msg);
    };
    await subscribeMessageLog(hass, 'meshtastic.ch', cb);

    conn.emit({
      event_type: 'meshtastic_message_log',
      data: { entity_id: 'meshtastic.ch', from_name: 'Alice', message: 'hello', pki: true },
      time_fired: '2023-05-01T12:00:00.000Z',
      context: { id: 'ctx-1', user_id: null, parent_id: null },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      id: 'ctx-1',
      time: '2023-05-01T12:00:00.000Z',
      fromName: 'Alice',
      message: 'hello',
      pki: true,
      source: 'live',
    });
  });

  it('labels outbound events as sent by "You" instead of the gateway node name', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);
    const received: ChatMessage[] = [];
    await subscribeMessageLog(hass, 'meshtastic.ch', (msg) => {
      received.push(msg);
    });

    conn.emit({
      event_type: 'meshtastic_message_log',
      data: {
        entity_id: 'meshtastic.ch',
        from_name: 'ChopMesh1 (!756f9ad8)',
        message: 'Test123',
        direction: 'out',
        to_name: 'Channel BeanChop',
      },
    });

    expect(received[0]).toMatchObject({ fromName: 'You', message: 'Test123', source: 'live' });
  });

  it('falls back to a synthetic id when context.id is missing', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);
    const received: ChatMessage[] = [];
    const cb = (msg: ChatMessage) => {
      received.push(msg);
    };
    await subscribeMessageLog(hass, 'meshtastic.ch', cb);

    conn.emit({
      event_type: 'meshtastic_message_log',
      data: { entity_id: 'meshtastic.ch', from_name: 'A', message: 'a' },
    });
    conn.emit({
      event_type: 'meshtastic_message_log',
      data: { entity_id: 'meshtastic.ch', from_name: 'B', message: 'b' },
    });

    expect(received[0].id).toMatch(/^live-/);
    expect(received[1].id).toMatch(/^live-/);
    expect(received[0].id).not.toBe(received[1].id);
  });

  it('returned unsubscribe function calls the underlying unsubscribe', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);
    const cb = vi.fn();
    const unsub = await subscribeMessageLog(hass, 'meshtastic.ch', cb);

    unsub();
    expect(conn.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('swallows errors thrown by the underlying unsubscribe', async () => {
    const conn = makeConnection();
    conn.unsubscribe.mockImplementation(() => {
      throw new Error('already gone');
    });
    const hass = makeHass(conn);
    const cb = vi.fn();
    const unsub = await subscribeMessageLog(hass, 'meshtastic.ch', cb);

    expect(() => {
      unsub();
    }).not.toThrow();
  });
});
