import { describe, expect, it, vi } from 'vitest';

import {
  listChannelStates,
  listGatewayStates,
  pickDefaultChannelEntity,
  pickDefaultGatewayEntity,
  resolveChannelName,
  resolveGatewayName,
  type ChannelState,
} from '../discovery.js';
import type { HomeAssistant } from '../ha-types.js';

const makeHass = (states: Record<string, unknown>, devices?: HomeAssistant['devices']): HomeAssistant => ({
  states: states as HomeAssistant['states'],
  callWS: vi.fn(),
  callService: vi.fn(),
  connection: {} as HomeAssistant['connection'],
  devices,
});

const makeChannel = (entity_id: string, attrs: Record<string, unknown> = {}): ChannelState => ({
  entity_id,
  state: 'idle',
  attributes: { device_class: 'channel', ...attrs },
  last_changed: '',
  last_updated: '',
  context: { id: '', user_id: null, parent_id: null },
});

describe('listChannelStates', () => {
  it('returns only meshtastic.* entities with device_class=channel', () => {
    const hass = makeHass({
      'meshtastic.gw_primary': makeChannel('meshtastic.gw_primary', { primary: true }),
      'meshtastic.other': {
        entity_id: 'meshtastic.other',
        attributes: { device_class: 'sensor' },
      },
      'sensor.something': {
        entity_id: 'sensor.something',
        attributes: { device_class: 'channel' },
      },
    });

    const channels = listChannelStates(hass);
    expect(channels.map((c) => c.entity_id)).toEqual(['meshtastic.gw_primary']);
  });

  it('returns [] when no channels exist', () => {
    const hass = makeHass({});
    expect(listChannelStates(hass)).toEqual([]);
  });
});

describe('pickDefaultChannelEntity', () => {
  it('prefers the primary channel when present', () => {
    const hass = makeHass({
      'meshtastic.a': makeChannel('meshtastic.a', { secondary: true }),
      'meshtastic.b': makeChannel('meshtastic.b', { primary: true }),
    });
    expect(pickDefaultChannelEntity(hass)).toBe('meshtastic.b');
  });

  it('falls back to the first channel when no primary is set', () => {
    const hass = makeHass({
      'meshtastic.a': makeChannel('meshtastic.a'),
      'meshtastic.b': makeChannel('meshtastic.b'),
    });
    expect(pickDefaultChannelEntity(hass)).toBe('meshtastic.a');
  });

  it('returns undefined when no channel entities exist', () => {
    expect(pickDefaultChannelEntity(makeHass({}))).toBeUndefined();
  });
});

describe('resolveGatewayName', () => {
  it('extracts the gateway name from the friendly_name "<gw> Channel <name>" format', () => {
    const hass = makeHass({});
    const ch = makeChannel('meshtastic.gw', { friendly_name: 'Base Camp Channel Primary' });
    expect(resolveGatewayName(hass, ch)).toBe('Base Camp');
  });

  it('falls back to "Gateway <node>" when the format does not match', () => {
    const hass = makeHass({});
    const ch = makeChannel('meshtastic.x', { friendly_name: 'something', node: '!abc' });
    expect(resolveGatewayName(hass, ch)).toBe('Gateway !abc');
  });

  it('falls back to the device registry when no node attribute', () => {
    const hass = makeHass({}, { d1: { name: 'Mesh Gateway 1' } });
    const ch = makeChannel('meshtastic.x', { friendly_name: 'something' });
    expect(resolveGatewayName(hass, ch)).toBe('Mesh Gateway 1');
  });

  it('prefers name_by_user over name in the device registry', () => {
    const hass = makeHass(
      {},
      {
        d1: { name: 'Default', name_by_user: 'My Mesh' },
      },
    );
    const ch = makeChannel('meshtastic.x', { friendly_name: 'something' });
    expect(resolveGatewayName(hass, ch)).toBe('My Mesh');
  });

  it('falls back to the friendly_name then entity_id when nothing else matches', () => {
    const hass = makeHass({});
    const ch = makeChannel('meshtastic.x', { friendly_name: 'something' });
    expect(resolveGatewayName(hass, ch)).toBe('something');

    const ch2 = makeChannel('meshtastic.y');
    expect(resolveGatewayName(hass, ch2)).toBe('meshtastic.y');
  });
});

describe('resolveChannelName', () => {
  it('returns the suffix after " Channel "', () => {
    const ch = makeChannel('meshtastic.gw', { friendly_name: 'Base Camp Channel LongFast' });
    expect(resolveChannelName(ch)).toBe('LongFast');
  });

  it('returns "Primary" / "Secondary" based on attribute flags', () => {
    expect(resolveChannelName(makeChannel('meshtastic.a', { primary: true }))).toBe('Primary');
    expect(resolveChannelName(makeChannel('meshtastic.b', { secondary: true }))).toBe('Secondary');
  });

  it('returns "Channel <index>" when only an index is present', () => {
    expect(resolveChannelName(makeChannel('meshtastic.a', { index: 3 }))).toBe('Channel 3');
  });

  it('falls back to friendly_name then entity_id', () => {
    expect(resolveChannelName(makeChannel('meshtastic.a', { friendly_name: 'Whatever' }))).toBe('Whatever');
    expect(resolveChannelName(makeChannel('meshtastic.b'))).toBe('meshtastic.b');
  });
});

describe('listGatewayStates / pickDefaultGatewayEntity', () => {
  const gateway = (entity_id: string, device_class = 'gateway') => ({
    entity_id,
    state: 'Connected',
    attributes: { device_class },
  });

  it('returns only meshtastic.* entities with device_class=gateway', () => {
    const hass = makeHass({
      'meshtastic.gateway_base': gateway('meshtastic.gateway_base'),
      'meshtastic.base_channel_primary': gateway('meshtastic.base_channel_primary', 'channel'),
      'sensor.gateway_like': gateway('sensor.gateway_like'),
    });
    expect(listGatewayStates(hass).map((s) => s.entity_id)).toEqual(['meshtastic.gateway_base']);
    expect(pickDefaultGatewayEntity(hass)).toBe('meshtastic.gateway_base');
  });

  it('returns undefined when there is no gateway', () => {
    expect(pickDefaultGatewayEntity(makeHass({}))).toBeUndefined();
  });
});
