// A fake `hass` shaped like the meshtastic integration's gateway device:
// one gateway entity whose attributes carry flattened local/module config
// (including secrets that must never be displayed), the node sensors that
// share its device, and an unrelated node on another device.

import { vi } from 'vitest';
import type { HassEntity } from 'home-assistant-js-websocket';

import type { HomeAssistant, HomeAssistantDevice, HomeAssistantEntityEntry } from '../../ha-types.js';

export const GATEWAY_ENTITY = 'meshtastic.gateway_base';
export const DEVICE_ID = 'dev-gw';
export const OTHER_DEVICE_ID = 'dev-other';
const P = 'meshtastic_base_1234';

export const SECRETS = {
  config_network_wifiPsk: 'hunter2-wifi',
  module_mqtt_password: 'hunter2-mqtt',
  module_mqtt_username: 'mesh-user',
  config_security_privateKey: 'PRIVATE-KEY==',
  config_security_adminKey: ['ADMIN-KEY=='],
};

export const GATEWAY_ATTRS: Record<string, unknown> = {
  device_class: 'gateway',
  friendly_name: 'Base Station',
  config_device_role: 'ROUTER_LATE',
  config_device_rebroadcastMode: 'ALL',
  config_bluetooth_enabled: true,
  config_network_wifiEnabled: false,
  config_lora_region: 'US',
  config_lora_usePreset: true,
  config_lora_modemPreset: 'LONG_FAST',
  config_lora_txPower: 30,
  config_lora_txEnabled: true,
  config_lora_hopLimit: 3,
  config_lora_channelNum: 0,
  config_position_gpsMode: 'ENABLED',
  config_position_fixedPosition: false,
  module_mqtt_enabled: true,
  module_storeForward_enabled: false,
  module_neighborInfo_enabled: true,
  ...SECRETS,
};

export const makeState = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: '',
  last_updated: '',
  context: { id: '', user_id: null, parent_id: null },
});

const sensor = (key: string, state: string, unit?: string, friendly?: string): HassEntity =>
  makeState(`sensor.${P}_${key}`, state, {
    ...(unit ? { unit_of_measurement: unit } : {}),
    ...(friendly ? { friendly_name: friendly } : {}),
  });

export const gatewayDeviceStates = (): HassEntity[] => [
  makeState(GATEWAY_ENTITY, 'Connected', { ...GATEWAY_ATTRS }),
  makeState('meshtastic.base_channel_primary', 'logging', { device_class: 'channel' }),
  sensor('node_short_name', 'BASE'),
  sensor('node_long_name', 'Base Station'),
  sensor('device_battery_level', '87', '%'),
  makeState(`binary_sensor.${P}_device_powered`, 'off'),
  sensor('device_voltage', '4.12', 'V'),
  sensor('device_uptime', '274320', 's'),
  sensor('device_channel_utilization', '12.4', '%'),
  sensor('device_airtime', '1.8', '%'),
  sensor('stats_nodes_online', '14'),
  sensor('stats_nodes_total', '52'),
  sensor('stats_packets_tx', '1204'),
  sensor('stats_packets_rx', '8331'),
  sensor('stats_packets_tx_relayed', '512'),
  sensor('stats_packets_tx_relay_cancelled', '41'),
  sensor('stats_packets_rx_duplicate', '90'),
  sensor('stats_packets_rx_bad', '3'),
  sensor('environment_temperature', '21.5', '°C', 'Base Station Temperature'),
  sensor('power_ch1_voltage', '5.01', 'V', 'Base Station Channel 1 Voltage'),
  makeState(`device_tracker.${P}_node_position`, 'not_home', {
    latitude: 47.6062,
    longitude: -122.3321,
    altitude: 56,
    satsInView: 9,
  }),
];

export interface RadioHassOptions {
  // Replace (or with `undefined`, remove) individual states by entity_id.
  states?: Record<string, HassEntity | undefined>;
  // Leave out `hass.entities` / `hass.devices` entirely.
  withoutRegistry?: boolean;
  device?: Partial<HomeAssistantDevice>;
}

export const makeRadioHass = (options: RadioHassOptions = {}): HomeAssistant => {
  const states: Record<string, HassEntity> = {};
  const entities: Record<string, HomeAssistantEntityEntry> = {};
  for (const s of gatewayDeviceStates()) {
    states[s.entity_id] = s;
    entities[s.entity_id] = { entity_id: s.entity_id, device_id: DEVICE_ID, platform: 'meshtastic' };
  }
  // A remote node on another device whose ids would also match by suffix.
  const other = makeState('sensor.meshtastic_base_5678_device_battery_level', '12', { unit_of_measurement: '%' });
  states[other.entity_id] = other;
  entities[other.entity_id] = { entity_id: other.entity_id, device_id: OTHER_DEVICE_ID, platform: 'meshtastic' };

  for (const [id, s] of Object.entries(options.states ?? {})) {
    if (s) {
      states[id] = s;
      entities[id] ??= { entity_id: id, device_id: DEVICE_ID, platform: 'meshtastic' };
    } else {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete states[id];
    }
  }

  const devices: Record<string, HomeAssistantDevice> = {
    [DEVICE_ID]: {
      id: DEVICE_ID,
      name: 'Base Station',
      model: 'T-Beam',
      sw_version: '2.5.6.abc123',
      serial_number: '!0000abcd',
      ...options.device,
    },
    [OTHER_DEVICE_ID]: { id: OTHER_DEVICE_ID, name: 'Remote Node' },
  };

  return {
    states,
    callWS: vi.fn(() => Promise.resolve([])) as unknown as HomeAssistant['callWS'],
    callService: vi.fn(),
    connection: { subscribeEvents: vi.fn() } as unknown as HomeAssistant['connection'],
    ...(options.withoutRegistry ? {} : { entities, devices }),
  };
};

export const sensorId = (key: string): string => `sensor.${P}_${key}`;
