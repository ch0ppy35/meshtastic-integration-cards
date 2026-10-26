// Static demo harness for <meshtastic-chat-card-dev> and
// <meshtastic-radio-card-dev>. Builds a fake HomeAssistant object, wires a
// controls panel to the cards' config, and lets you inject fake live messages
// and telemetry so the UI can be exercised without HA.

import type { Connection, HassEntity } from 'home-assistant-js-websocket';
import type { HomeAssistant, HomeAssistantDevice, HomeAssistantEntityEntry } from '../src/ha-types';
import type { ChatCardConfig, LogbookEntry, MeshtasticMessageLogEvent, RadioCardConfig } from '../src/types';

// Inlined to keep this bundle independent of the card bundle (no shared
// rollup chunk). Must match `MESHTASTIC_MESSAGE_LOG_EVENT` in src/types.ts.
const MESSAGE_LOG_EVENT = 'meshtastic_message_log' as const;

const CHANNEL_ENTITY = 'meshtastic.demo_channel';
const FRIENDLY_NAME = 'Demo Channel';

interface DemoState {
  history: LogbookEntry[];
  emit: (event: MeshtasticMessageLogEvent) => void;
}

const SAMPLE_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank'];
const SAMPLE_MESSAGES = [
  'hello mesh',
  'anyone copy?',
  'rebooting node',
  'trail conditions look good',
  'battery 78%',
  'GPS lock acquired',
  'relay heard',
];

const sample = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------------------
// Radio card data: a gateway device shaped like the integration's.
// ---------------------------------------------------------------------------

const GATEWAY_ENTITY = 'meshtastic.gateway_demo';
const GATEWAY_DEVICE_ID = 'demo-gateway-device';
const SENSOR_PREFIX = 'meshtastic_demo_1';

interface Telemetry {
  battery: number;
  voltage: number;
  uptime: number;
  channelUtil: number;
  airtime: number;
  online: number;
  total: number;
  tx: number;
  rx: number;
  relayed: number;
  canceled: number;
  dupes: number;
  bad: number;
  temperature: number;
  humidity: number;
}

const initialTelemetry = (): Telemetry => ({
  battery: 87,
  voltage: 4.12,
  uptime: 274_320,
  channelUtil: 12.4,
  airtime: 1.8,
  online: 14,
  total: 52,
  tx: 1204,
  rx: 8331,
  relayed: 512,
  canceled: 41,
  dupes: 90,
  bad: 3,
  temperature: 21.5,
  humidity: 48,
});

const jitter = (value: number, spread: number, digits = 1): number =>
  Number((value + (Math.random() * 2 - 1) * spread).toFixed(digits));

// Advance telemetry the way a live radio would: counters grow, gauges wobble.
const nextTelemetry = (t: Telemetry): Telemetry => ({
  ...t,
  battery: Math.max(0, Math.min(100, Math.round(jitter(t.battery, 2, 0)))),
  voltage: jitter(t.voltage, 0.03, 2),
  uptime: t.uptime + 300,
  channelUtil: Math.max(0, jitter(t.channelUtil, 1.5)),
  airtime: Math.max(0, jitter(t.airtime, 0.3)),
  online: Math.max(1, Math.round(jitter(t.online, 2, 0))),
  tx: t.tx + Math.round(Math.random() * 6),
  rx: t.rx + Math.round(Math.random() * 40),
  relayed: t.relayed + Math.round(Math.random() * 5),
  temperature: jitter(t.temperature, 0.4),
});

const radioState = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: new Date().toISOString(),
  last_updated: new Date().toISOString(),
  context: { id: 'demo-ctx', user_id: null, parent_id: null },
});

const buildRadioStates = (t: Telemetry, connected: boolean): HassEntity[] => {
  const sensor = (key: string, value: number | string, unit?: string, friendly?: string): HassEntity =>
    radioState(`sensor.${SENSOR_PREFIX}_${key}`, String(value), {
      ...(unit ? { unit_of_measurement: unit } : {}),
      ...(friendly ? { friendly_name: `Demo Gateway ${friendly}` } : {}),
    });
  return [
    radioState(GATEWAY_ENTITY, connected ? 'Connected' : 'unavailable', {
      device_class: 'gateway',
      friendly_name: 'Demo Gateway',
      config_device_role: 'ROUTER_LATE',
      config_device_rebroadcastMode: 'ALL',
      config_bluetooth_enabled: true,
      config_network_wifiEnabled: true,
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
      module_rangeTest_enabled: false,
      // Present on real gateways; the card must never show these.
      config_network_wifiPsk: 'demo-wifi-secret',
      module_mqtt_password: 'demo-mqtt-secret',
      config_security_privateKey: 'demo-private-key',
    }),
    sensor('node_short_name', 'DEMO'),
    sensor('node_long_name', 'Demo Gateway'),
    sensor('device_battery_level', t.battery, '%'),
    radioState(`binary_sensor.${SENSOR_PREFIX}_device_powered`, 'off'),
    sensor('device_voltage', t.voltage, 'V'),
    sensor('device_uptime', t.uptime, 's'),
    sensor('device_channel_utilization', t.channelUtil, '%'),
    sensor('device_airtime', t.airtime, '%'),
    sensor('stats_nodes_online', t.online),
    sensor('stats_nodes_total', t.total),
    sensor('stats_packets_tx', t.tx),
    sensor('stats_packets_rx', t.rx),
    sensor('stats_packets_tx_relayed', t.relayed),
    sensor('stats_packets_tx_relay_cancelled', t.canceled),
    sensor('stats_packets_rx_duplicate', t.dupes),
    sensor('stats_packets_rx_bad', t.bad),
    sensor('environment_temperature', t.temperature, '°C', 'Temperature'),
    sensor('environment_relative_humidity', t.humidity, '%', 'Relative Humidity'),
    radioState(`device_tracker.${SENSOR_PREFIX}_node_position`, 'not_home', {
      latitude: 47.6062,
      longitude: -122.3321,
      altitude: 56,
      satsInView: 9,
    }),
  ];
};

const DEMO_DEVICES: Record<string, HomeAssistantDevice> = {
  [GATEWAY_DEVICE_ID]: {
    id: GATEWAY_DEVICE_ID,
    name: 'Demo Gateway',
    manufacturer: 'Meshtastic',
    model: 'T-Beam',
    sw_version: '2.5.6.abc123',
    serial_number: '!0000d3m0',
  },
};

// Return a new hass object with the radio states replaced, the way HA hands
// cards a fresh `hass` on every state change.
const withRadioStates = (hass: HomeAssistant, t: Telemetry, connected: boolean): HomeAssistant => {
  const states = { ...hass.states };
  const entities: Record<string, HomeAssistantEntityEntry> = { ...hass.entities };
  for (const s of buildRadioStates(t, connected)) {
    states[s.entity_id] = s;
    entities[s.entity_id] = { entity_id: s.entity_id, device_id: GATEWAY_DEVICE_ID, platform: 'meshtastic' };
  }
  return { ...hass, states, entities, devices: { ...hass.devices, ...DEMO_DEVICES } };
};

const buildHistory = (count: number): LogbookEntry[] => {
  const now = Date.now();
  const entries: LogbookEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const ageMs = (count - i) * 60_000;
    const when = (now - ageMs) / 1000;
    entries.push({
      when,
      name: sample(SAMPLE_NAMES),
      message: `«${sample(SAMPLE_MESSAGES)}» by ${sample(SAMPLE_NAMES)}`,
      entity_id: CHANNEL_ENTITY,
      domain: 'meshtastic',
      icon: i % 5 === 0 ? 'mdi:message-lock' : undefined,
      context_id: `hist-${String(i)}`,
    });
  }
  return entries;
};

const makeFakeHass = (state: DemoState): HomeAssistant => {
  let listener: ((event: MeshtasticMessageLogEvent) => void) | undefined;

  const stateObj: HassEntity = {
    entity_id: CHANNEL_ENTITY,
    state: 'idle',
    attributes: {
      device_class: 'channel',
      friendly_name: FRIENDLY_NAME,
    },
    last_changed: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    context: { id: 'demo-ctx', user_id: null, parent_id: null },
  };

  const connection = {
    subscribeEvents: (cb: (event: MeshtasticMessageLogEvent) => void, _eventType: string): Promise<() => void> => {
      listener = cb;
      return Promise.resolve(() => {
        listener = undefined;
      });
    },
  } as unknown as Connection;

  const hass: HomeAssistant = {
    states: { [CHANNEL_ENTITY]: stateObj },
    connection,
    callWS: <T>(msg: Record<string, unknown>): Promise<T> => {
      // eslint-disable-next-line no-console
      console.debug('[demo] callWS', msg);
      if (msg.type === 'logbook/get_events') {
        return Promise.resolve(state.history as unknown as T);
      }
      return Promise.resolve([] as unknown as T);
    },
    callService: (domain: string, service: string, data?: Record<string, unknown>): Promise<unknown> => {
      // eslint-disable-next-line no-console
      console.info('[demo] callService', domain, service, data);
      // Mirror the integration: a sent message is reported back on the event
      // stream with direction "out".
      if (domain === 'meshtastic' && typeof data?.message === 'string') {
        state.emit({
          event_type: MESSAGE_LOG_EVENT,
          data: {
            entity_id: CHANNEL_ENTITY,
            from_name: 'Demo Gateway (!00000001)',
            message: data.message,
            direction: 'out',
            to_name: FRIENDLY_NAME,
          },
          time_fired: new Date().toISOString(),
          context: { id: `sent-${String(Date.now())}`, user_id: null, parent_id: null },
        });
      }
      return Promise.resolve(undefined);
    },
  };

  state.emit = (event) => {
    if (!listener) {
      // Card hasn't called subscribeEvents yet — retry on next tick.
      setTimeout(() => {
        state.emit(event);
      }, 16);
      return;
    }
    listener(event);
  };

  return hass;
};

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
};

const input = (id: string): HTMLInputElement => $(id) as HTMLInputElement;
const select = (id: string): HTMLSelectElement => $(id) as HTMLSelectElement;

const readConfig = (): ChatCardConfig => ({
  channel_entity: CHANNEL_ENTITY,
  title: input('opt-title').value || undefined,
  limit: Number(input('opt-limit').value) || 200,
  show_timestamps: input('opt-timestamps').checked,
  enable_send: input('opt-send').checked,
  sort_order: select('opt-sort').value as 'asc' | 'desc',
});

interface CardEl extends HTMLElement {
  hass: HomeAssistant;
  setConfig: (cfg: ChatCardConfig) => void;
}

interface RadioCardEl extends HTMLElement {
  hass: HomeAssistant;
  setConfig: (cfg: RadioCardConfig) => void;
}

const readRadioConfig = (): RadioCardConfig => ({
  gateway_entity: GATEWAY_ENTITY,
  show_config: input('opt-radio-config').checked,
});

const main = (): void => {
  const host = $('card-host') as HTMLDivElement;

  const state: DemoState = {
    history: buildHistory(8),
    emit: () => undefined,
  };
  let telemetry = initialTelemetry();
  let hass = withRadioStates(makeFakeHass(state), telemetry, true);

  const mountCard = (): CardEl => {
    host.replaceChildren();
    const el = document.createElement('meshtastic-chat-card-dev') as CardEl;
    el.setConfig(readConfig());
    el.hass = hass;
    host.appendChild(el);
    return el;
  };

  let card = mountCard();

  const radio = document.createElement('meshtastic-radio-card-dev') as RadioCardEl;
  radio.setConfig(readRadioConfig());
  radio.hass = hass;
  $('radio-host').appendChild(radio);

  const pushRadioStates = (): void => {
    hass = withRadioStates(hass, telemetry, input('opt-radio-connected').checked);
    card.hass = hass;
    radio.hass = hass;
  };

  input('opt-radio-config').addEventListener('change', () => {
    radio.setConfig(readRadioConfig());
  });
  input('opt-radio-connected').addEventListener('change', pushRadioStates);
  $('btn-telemetry').addEventListener('click', () => {
    telemetry = nextTelemetry(telemetry);
    pushRadioStates();
  });

  const applyConfig = (): void => {
    card.setConfig(readConfig());
  };

  for (const id of ['opt-title', 'opt-limit', 'opt-timestamps', 'opt-send', 'opt-sort']) {
    $(id).addEventListener('change', applyConfig);
    $(id).addEventListener('input', applyConfig);
  }

  const applySize = (): void => {
    host.style.width = `${input('opt-width').value}px`;
    host.style.height = `${input('opt-height').value}px`;
  };
  input('opt-width').addEventListener('input', applySize);
  input('opt-height').addEventListener('input', applySize);
  applySize();

  $('btn-inject').addEventListener('click', () => {
    state.emit({
      event_type: MESSAGE_LOG_EVENT,
      data: {
        entity_id: CHANNEL_ENTITY,
        from_name: sample(SAMPLE_NAMES),
        message: sample(SAMPLE_MESSAGES),
        pki: input('opt-pki').checked,
      },
      time_fired: new Date().toISOString(),
      context: { id: `inj-${String(Date.now())}`, user_id: null, parent_id: null },
    });
  });

  $('btn-replay').addEventListener('click', () => {
    state.history = buildHistory(Number(input('opt-history').value) || 8);
    // Re-mount so the card runs its initial history load + subscribe again.
    card = mountCard();
  });
};

main();
