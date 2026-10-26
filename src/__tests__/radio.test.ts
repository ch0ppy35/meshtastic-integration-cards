import { describe, expect, it } from 'vitest';

import {
  NO_VALUE,
  assertRadioConfig,
  buildHeaderMeta,
  buildRadioSections,
  findByKey,
  findDeviceEntities,
  formatEnum,
  formatState,
  formatUptime,
  resolveGateway,
  resolveTitle,
  type GatewayContext,
  type RadioSection,
} from '../radio.js';
import type { RadioCardConfig } from '../types.js';
import {
  DEVICE_ID,
  GATEWAY_ATTRS,
  GATEWAY_ENTITY,
  SECRETS,
  makeRadioHass,
  makeState,
  sensorId,
  type RadioHassOptions,
} from './fixtures/radio.js';

const ctxFor = (options?: RadioHassOptions): GatewayContext => {
  const ctx = resolveGateway(makeRadioHass(options), GATEWAY_ENTITY);
  if (!ctx) throw new Error('gateway not resolved');
  return ctx;
};

const sectionsFor = (
  config: Partial<RadioCardConfig> = {},
  options?: RadioHassOptions,
): Record<string, RadioSection | undefined> => {
  const sections = buildRadioSections(ctxFor(options), config);
  return Object.fromEntries(sections.map((s) => [s.id, s]));
};

const rowValue = (section: RadioSection | undefined, label: string): string | undefined =>
  section?.rows.find((r) => r.label === label)?.value;

describe('resolveGateway / findDeviceEntities', () => {
  it('resolves the device and only the entities registered to it', () => {
    const ctx = ctxFor();
    expect(ctx.deviceId).toBe(DEVICE_ID);
    expect(ctx.device?.model).toBe('T-Beam');
    expect(ctx.entities.some((e) => e.entity_id === GATEWAY_ENTITY)).toBe(true);
    expect(ctx.entities.some((e) => e.entity_id.includes('_5678_'))).toBe(false);
  });

  it('returns undefined when the gateway entity does not exist', () => {
    expect(resolveGateway(makeRadioHass(), 'meshtastic.nope')).toBeUndefined();
  });

  it('returns no device entities when hass.entities is missing', () => {
    const hass = makeRadioHass({ withoutRegistry: true });
    expect(findDeviceEntities(hass, DEVICE_ID)).toEqual([]);
    const ctx = resolveGateway(hass, GATEWAY_ENTITY);
    expect(ctx?.deviceId).toBeUndefined();
    expect(ctx?.entities).toEqual([]);
  });

  it('skips registry entries whose state is missing', () => {
    const hass = makeRadioHass({ states: { [sensorId('device_voltage')]: undefined } });
    expect(findDeviceEntities(hass, DEVICE_ID).some((e) => e.entity_id === sensorId('device_voltage'))).toBe(false);
  });
});

describe('findByKey', () => {
  const entities = [
    makeState('sensor.m_1_stats_packets_tx_relayed', '512'),
    makeState('sensor.m_1_stats_packets_tx', '1204'),
    makeState('sensor.m_1_power_ch1_voltage', '5.01'),
    makeState('sensor.m_1_device_voltage', '4.12'),
  ];

  it('matches the full key suffix, not a prefix of a longer key', () => {
    expect(findByKey(entities, 'stats_packets_tx')?.state).toBe('1204');
    expect(findByKey(entities, 'stats_packets_tx_relayed')?.state).toBe('512');
  });

  it('does not confuse device_voltage with power channel voltages', () => {
    expect(findByKey(entities, 'device_voltage')?.state).toBe('4.12');
  });

  it('returns undefined when nothing matches', () => {
    expect(findByKey(entities, 'device_uptime')).toBeUndefined();
  });
});

describe('formatters', () => {
  it('formatUptime', () => {
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(59)).toBe('59s');
    expect(formatUptime(60)).toBe('1m');
    expect(formatUptime(3600)).toBe('1h');
    expect(formatUptime(274_320)).toBe('3d 4h 12m');
    expect(formatUptime(86_400 + 60)).toBe('1d 1m');
    expect(formatUptime(-1)).toBe(NO_VALUE);
    expect(formatUptime(Number.NaN)).toBe(NO_VALUE);
  });

  it('formatEnum title-cases protobuf enum names and keeps acronyms', () => {
    expect(formatEnum('LONG_FAST')).toBe('Long Fast');
    expect(formatEnum('ROUTER_LATE')).toBe('Router Late');
    expect(formatEnum('TAK_TRACKER')).toBe('TAK Tracker');
    expect(formatEnum('')).toBeUndefined();
    expect(formatEnum(3)).toBeUndefined();
  });

  it('formatState adds units, groups numbers and maps unavailable to a dash', () => {
    expect(formatState(makeState('sensor.a', '4.12', { unit_of_measurement: 'V' }))).toBe('4.12 V');
    expect(formatState(makeState('sensor.a', '8331'))).toBe('8,331');
    expect(formatState(makeState('sensor.a', '1.23456'))).toBe('1.23');
    expect(formatState(makeState('sensor.a', 'CLIENT'))).toBe('CLIENT');
    expect(formatState(makeState('sensor.a', '87', { unit_of_measurement: '%' }), false)).toBe('87');
    expect(formatState(makeState('sensor.a', 'unavailable'))).toBe(NO_VALUE);
    expect(formatState(makeState('sensor.a', 'unknown'))).toBe(NO_VALUE);
    expect(formatState(undefined)).toBe(NO_VALUE);
  });
});

describe('buildRadioSections', () => {
  it('builds every section in a fixed order', () => {
    const ids = buildRadioSections(ctxFor(), {}).map((s) => s.id);
    expect(ids).toEqual(['device', 'radio', 'mesh', 'traffic', 'environment', 'position', 'modules']);
  });

  it('fills the device section from sensors, the registry and config', () => {
    const { device } = sectionsFor();
    expect(rowValue(device, 'Battery')).toBe('87 %');
    expect(rowValue(device, 'Voltage')).toBe('4.12 V');
    expect(rowValue(device, 'Uptime')).toBe('3d 4h 12m');
    expect(rowValue(device, 'Node ID')).toBe('!0000abcd');
    expect(rowValue(device, 'Role')).toBe('Router Late');
    expect(rowValue(device, 'Rebroadcast')).toBe('All');
    expect(rowValue(device, 'Bluetooth')).toBe('On');
    expect(rowValue(device, 'Wi-Fi')).toBe('Off');
  });

  it('marks the battery as powered when the powered binary sensor is on', () => {
    const { device } = sectionsFor(
      {},
      {
        states: {
          [`binary_sensor.meshtastic_base_1234_device_powered`]: makeState(
            'binary_sensor.meshtastic_base_1234_device_powered',
            'on',
          ),
        },
      },
    );
    expect(rowValue(device, 'Battery')).toBe('87 % · Powered');
  });

  it('converts uptime reported in other duration units', () => {
    const { device } = sectionsFor(
      {},
      {
        states: {
          [sensorId('device_uptime')]: makeState(sensorId('device_uptime'), '90', { unit_of_measurement: 'min' }),
        },
      },
    );
    expect(rowValue(device, 'Uptime')).toBe('1h 30m');
  });

  it('fills the radio section with utilisation and LoRa config', () => {
    const { radio } = sectionsFor();
    expect(rowValue(radio, 'Channel util.')).toBe('12.4 %');
    expect(rowValue(radio, 'Airtime TX')).toBe('1.8 %');
    expect(rowValue(radio, 'Region')).toBe('US');
    expect(rowValue(radio, 'Modem preset')).toBe('Long Fast');
    expect(rowValue(radio, 'TX power')).toBe('30 dBm');
    expect(rowValue(radio, 'Transmit')).toBe('On');
    expect(rowValue(radio, 'Hop limit')).toBe('3');
    expect(rowValue(radio, 'Frequency slot')).toBe('Default');
  });

  it('describes custom modem settings when presets are off', () => {
    const gateway = makeState(GATEWAY_ENTITY, 'Connected', {
      ...GATEWAY_ATTRS,
      config_lora_usePreset: false,
      config_lora_bandwidth: 250,
      config_lora_spreadFactor: 11,
      config_lora_codingRate: 5,
      config_lora_txPower: 0,
    });
    const { radio } = sectionsFor({}, { states: { [GATEWAY_ENTITY]: gateway } });
    expect(rowValue(radio, 'Modem preset')).toBe('Custom · 250 kHz · SF11 · CR 4/5');
    expect(rowValue(radio, 'TX power')).toBe('Default');
  });

  it('combines online and total node counts', () => {
    expect(rowValue(sectionsFor().mesh, 'Nodes')).toBe('14 online / 52 total');
    const onlyOnline = sectionsFor({}, { states: { [sensorId('stats_nodes_total')]: undefined } });
    expect(rowValue(onlyOnline.mesh, 'Nodes')).toBe('14 online');
  });

  it('lists all six traffic counters', () => {
    const { traffic } = sectionsFor();
    expect(traffic?.rows.map((r) => [r.label, r.value])).toEqual([
      ['Sent', '1,204'],
      ['Received', '8,331'],
      ['Relayed', '512'],
      ['Relay canceled', '41'],
      ['Duplicates', '90'],
      ['Malformed', '3'],
    ]);
  });

  it('collects telemetry sensors generically, without the device name prefix', () => {
    const { environment } = sectionsFor();
    expect(environment?.rows.map((r) => [r.label, r.value])).toEqual([
      ['Channel 1 Voltage', '5.01 V'],
      ['Temperature', '21.5 °C'],
    ]);
  });

  it('shows position from the device tracker plus GPS config', () => {
    const { position } = sectionsFor();
    expect(rowValue(position, 'Location')).toBe('47.60620, -122.33210');
    expect(rowValue(position, 'Altitude')).toBe('56 m');
    expect(rowValue(position, 'Satellites')).toBe('9');
    expect(rowValue(position, 'GPS')).toBe('Enabled');
    expect(rowValue(position, 'Fixed position')).toBe('Off');
  });

  it('shows a dash for an unavailable tracker', () => {
    const tracker = 'device_tracker.meshtastic_base_1234_node_position';
    const { position } = sectionsFor({}, { states: { [tracker]: makeState(tracker, 'unavailable') } });
    expect(rowValue(position, 'Location')).toBe(NO_VALUE);
  });

  it('lists only enabled modules', () => {
    expect(rowValue(sectionsFor().modules, 'Enabled')).toBe('MQTT · Neighbor Info');
    const gateway = makeState(GATEWAY_ENTITY, 'Connected', {
      ...GATEWAY_ATTRS,
      module_mqtt_enabled: false,
      module_neighborInfo_enabled: false,
    });
    expect(rowValue(sectionsFor({}, { states: { [GATEWAY_ENTITY]: gateway } }).modules, 'Enabled')).toBe('None');
  });

  it('never emits secret config attributes', () => {
    const text = JSON.stringify(buildRadioSections(ctxFor(), {}));
    for (const [key, value] of Object.entries(SECRETS)) {
      expect(text).not.toContain(key);
      for (const v of [value].flat()) expect(text).not.toContain(v);
    }
    expect(text).not.toMatch(/psk|password|privateKey|adminKey/i);
  });

  it('renders unavailable sensors as a dash rather than dropping them', () => {
    const id = sensorId('device_voltage');
    const { device } = sectionsFor(
      {},
      { states: { [id]: makeState(id, 'unavailable', { unit_of_measurement: 'V' }) } },
    );
    expect(rowValue(device, 'Voltage')).toBe(NO_VALUE);
  });

  it('drops rows without a backing entity and sections that end up empty', () => {
    const gateway = makeState(GATEWAY_ENTITY, 'Connected', { device_class: 'gateway' });
    const sections = sectionsFor({}, { states: { [GATEWAY_ENTITY]: gateway } });
    expect(sections.modules).toBeUndefined();
    expect(rowValue(sections.radio, 'Region')).toBeUndefined();
    expect(rowValue(sections.radio, 'Channel util.')).toBe('12.4 %');
  });

  it('filters to the configured sections', () => {
    const ids = buildRadioSections(ctxFor(), { sections: ['traffic', 'device'] }).map((s) => s.id);
    expect(ids).toEqual(['device', 'traffic']);
  });

  it('hides config rows when show_config is false', () => {
    const sections = sectionsFor({ show_config: false });
    expect(sections.modules).toBeUndefined();
    expect(rowValue(sections.radio, 'Region')).toBeUndefined();
    expect(rowValue(sections.radio, 'Channel util.')).toBe('12.4 %');
    expect(rowValue(sections.device, 'Role')).toBeUndefined();
  });

  it('gives every row a unique key', () => {
    const keys = buildRadioSections(ctxFor(), {}).flatMap((s) => s.rows.map((r) => r.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('header', () => {
  it('builds meta from short name, model and firmware', () => {
    expect(buildHeaderMeta(ctxFor())).toBe('BASE · T-Beam · v2.5.6.abc123');
  });

  it('omits missing firmware and flags a disconnected gateway', () => {
    const gateway = makeState(GATEWAY_ENTITY, 'unavailable', { ...GATEWAY_ATTRS });
    const ctx = ctxFor({ device: { sw_version: null }, states: { [GATEWAY_ENTITY]: gateway } });
    expect(buildHeaderMeta(ctx)).toBe('BASE · T-Beam · Disconnected');
  });

  it('resolves the title from config, then device, then long name, then friendly name', () => {
    expect(resolveTitle(ctxFor(), { title: 'Mine' })).toBe('Mine');
    expect(resolveTitle(ctxFor({ device: { name_by_user: 'Roof' } }), {})).toBe('Roof');
    expect(resolveTitle(ctxFor({ device: { name: null } }), {})).toBe('Base Station');
    expect(resolveTitle(ctxFor({ withoutRegistry: true }), {})).toBe('Base Station');
  });
});

describe('assertRadioConfig', () => {
  it('accepts a minimal config', () => {
    expect(() => {
      assertRadioConfig({ gateway_entity: GATEWAY_ENTITY });
    }).not.toThrow();
  });

  it('requires gateway_entity', () => {
    expect(() => {
      assertRadioConfig(undefined);
    }).toThrow(/Invalid configuration/);
    expect(() => {
      assertRadioConfig({});
    }).toThrow(/gateway_entity/);
  });

  it('rejects unknown sections', () => {
    expect(() => {
      assertRadioConfig({ gateway_entity: GATEWAY_ENTITY, sections: ['device', 'bogus' as never] });
    }).toThrow(/Unknown section\(s\): bogus/);
    expect(() => {
      assertRadioConfig({ gateway_entity: GATEWAY_ENTITY, sections: 'device' as never });
    }).toThrow(/must be a list/);
  });
});
