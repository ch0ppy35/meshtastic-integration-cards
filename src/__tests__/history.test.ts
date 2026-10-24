import { describe, expect, it, vi } from 'vitest';

import { loadHistory } from '../history.js';
import type { HomeAssistant } from '../ha-types.js';
import type { LogbookEntry } from '../types.js';

const makeHass = (entries: LogbookEntry[] | (() => Promise<LogbookEntry[]>)): HomeAssistant => {
  const callWS = vi.fn(async () => {
    return typeof entries === 'function' ? await entries() : entries;
  }) as unknown as HomeAssistant['callWS'];
  return {
    callWS,
    callService: vi.fn(),
    states: {},
    connection: {} as HomeAssistant['connection'],
  };
};

describe('loadHistory', () => {
  it('parses the «message» by name format', async () => {
    const hass = makeHass([
      { when: 1700000000.5, message: '«hello world» by Alice', domain: 'meshtastic', entity_id: 'meshtastic.ch' },
    ]);
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      message: 'hello world',
      fromName: 'Alice',
      pki: false,
      source: 'history',
    });
  });

  it('preserves messages that contain " by " in the body via last-occurrence split', async () => {
    const hass = makeHass([
      { when: 1700000000, message: '«stand by for tea» by Bob', domain: 'meshtastic', entity_id: 'meshtastic.ch' },
    ]);
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    expect(msgs[0]?.message).toBe('stand by for tea');
    expect(msgs[0]?.fromName).toBe('Bob');
  });

  it('converts numeric float `when` (epoch seconds) to ISO string', async () => {
    const seconds = 1_700_000_000.123;
    const hass = makeHass([{ when: seconds, message: '«x» by y', entity_id: 'meshtastic.ch' }]);
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    const got = new Date(msgs[0].time).getTime();
    expect(Math.abs(got - seconds * 1000)).toBeLessThan(2);
  });

  it('preserves ISO string `when` values', async () => {
    const iso = '2023-05-01T12:00:00.000Z';
    const hass = makeHass([{ when: iso, message: '«x» by y', entity_id: 'meshtastic.ch' }]);
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    expect(msgs[0]?.time).toBe(iso);
  });

  it('marks entries with mdi:message-lock icon as PKI', async () => {
    const hass = makeHass([
      {
        when: 1,
        message: '«secret» by Alice',
        entity_id: 'meshtastic.ch',
        icon: 'mdi:message-lock',
      },
    ]);
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    expect(msgs[0]?.pki).toBe(true);
  });

  it('filters out entries from a different entity', async () => {
    const hass = makeHass([
      { when: 1, message: '«x» by y', entity_id: 'meshtastic.other' },
      { when: 2, message: '«ok» by Alice', entity_id: 'meshtastic.ch' },
    ]);
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.message).toBe('ok');
  });

  it('filters out entries from a different domain', async () => {
    const hass = makeHass([
      { when: 1, message: '«x» by y', domain: 'sensor', entity_id: 'meshtastic.ch' },
      { when: 2, message: '«ok» by Alice', domain: 'meshtastic', entity_id: 'meshtastic.ch' },
    ]);
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.message).toBe('ok');
  });

  it('falls back to raw message + entry.name when describer format is missing', async () => {
    const hass = makeHass([
      {
        when: 1,
        message: 'plain log line',
        name: 'Charlie',
        entity_id: 'meshtastic.ch',
        domain: 'meshtastic',
      },
    ]);
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ message: 'plain log line', fromName: 'Charlie' });
  });

  it('uses "Unknown" when fallback has no name', async () => {
    const hass = makeHass([{ when: 1, message: 'plain log line', entity_id: 'meshtastic.ch' }]);
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    expect(msgs[0]?.fromName).toBe('Unknown');
  });

  it('returns [] when callWS rejects, without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const callWS = vi.fn(() => Promise.reject(new Error('boom'))) as unknown as HomeAssistant['callWS'];
    const callService = vi.fn() as unknown as HomeAssistant['callService'];
    const hass: HomeAssistant = {
      callWS,
      callService,
      states: {},
      connection: {} as HomeAssistant['connection'],
    };
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    expect(msgs).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('parses outbound «message» to recipient entries as sent by "You"', async () => {
    const hass = makeHass([
      {
        when: 1,
        message: '«Test123» to Channel BeanChop',
        entity_id: 'meshtastic.ch',
        domain: 'meshtastic',
        icon: 'mdi:message-arrow-right',
      },
    ]);
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ message: 'Test123', fromName: 'You', pki: false, source: 'history' });
  });

  it('keeps " to " in an outbound message body and marks outbound PKI entries', async () => {
    const hass = makeHass([
      {
        when: 1,
        message: '«talk to me» to ChopMesh2 (!1234abcd)',
        entity_id: 'meshtastic.ch',
        domain: 'meshtastic',
        icon: 'mdi:message-lock',
      },
    ]);
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    expect(msgs[0]).toMatchObject({ message: 'talk to me', fromName: 'You', pki: true });
  });

  it('uses context_id as the message id when provided', async () => {
    const hass = makeHass([{ when: 1, message: '«x» by y', entity_id: 'meshtastic.ch', context_id: 'ctx-123' }]);
    const msgs = await loadHistory(hass, 'meshtastic.ch');
    expect(msgs[0]?.id).toBe('ctx-123');
  });
});
