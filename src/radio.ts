// Pure helpers behind the radio card: find the gateway's device and sensors,
// format their states and assemble the sections the card renders. No Lit
// here so it can be unit tested directly.
//
// Entity ids mirror the upstream integration (custom_components/meshtastic/
// entity.py `MeshtasticNodeEntity`):
//   <platform>.meshtastic_<gateway short name>_<node num>_<key>
// The gateway entity's attributes are a flattened protobuf dict of the
// radio's local + module config (`config_lora_region`, `module_mqtt_enabled`,
// ...). They include secrets (Wi-Fi PSK, MQTT password, private keys), so the
// card only ever reads the attributes named in this file.

import { type HassEntity } from 'home-assistant-js-websocket';

import type { HomeAssistant, HomeAssistantDevice } from './ha-types';
import { RADIO_SECTIONS, type RadioCardConfig, type RadioSectionId } from './types';

export const NO_VALUE = '—';

export interface RadioRow {
  // Stable id used as a Lit `repeat` key and for live-flash diffing.
  key: string;
  label: string;
  value: string;
}

export interface RadioSection {
  id: RadioSectionId;
  title: string;
  rows: RadioRow[];
}

export interface GatewayContext {
  gateway: HassEntity;
  deviceId: string | undefined;
  device: HomeAssistantDevice | undefined;
  // States of every entity registered to the gateway's device.
  entities: HassEntity[];
}

export const SECTION_TITLES: Record<RadioSectionId, string> = {
  device: 'Device',
  radio: 'Radio',
  mesh: 'Mesh',
  traffic: 'Traffic',
  environment: 'Sensors',
  position: 'Position',
  modules: 'Modules',
};

// Module config blocks that carry an `enabled` flag, in display order.
const MODULES: readonly (readonly [string, string])[] = [
  ['mqtt', 'MQTT'],
  ['storeForward', 'Store & Forward'],
  ['rangeTest', 'Range Test'],
  ['neighborInfo', 'Neighbor Info'],
  ['serial', 'Serial'],
  ['externalNotification', 'External Notification'],
  ['detectionSensor', 'Detection Sensor'],
  ['paxcounter', 'Paxcounter'],
];

// Words `formatEnum` keeps upper-case.
const ACRONYMS = new Set(['TAK', 'GPS', 'MQTT', 'LORA', 'NMEA']);

// Telemetry sensors collected generically into the "Sensors" section.
const GENERIC_SENSOR_RE = /^sensor\..*_(environment_|airquality_|power_ch\d+_)/;

const UNIT_SECONDS: Record<string, number> = { s: 1, min: 60, h: 3600, d: 86_400 };

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

// Shared by `setConfig` and the visual editor's `assertConfig`.
export function assertRadioConfig(config: Partial<RadioCardConfig> | undefined): asserts config is RadioCardConfig {
  if (!config) throw new Error('Invalid configuration.');
  if (!config.gateway_entity || typeof config.gateway_entity !== 'string') {
    throw new Error('You need to set `gateway_entity` (a meshtastic gateway entity).');
  }
  if (config.sections !== undefined) {
    if (!Array.isArray(config.sections)) throw new Error('`sections` must be a list.');
    const unknown = config.sections.filter((s) => !(RADIO_SECTIONS as readonly string[]).includes(s));
    if (unknown.length > 0) {
      throw new Error(`Unknown section(s): ${unknown.join(', ')}. Valid: ${RADIO_SECTIONS.join(', ')}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

// States of every entity in the entity registry that belongs to `deviceId`.
export const findDeviceEntities = (hass: HomeAssistant, deviceId: string): HassEntity[] => {
  const out: HassEntity[] = [];
  for (const entry of Object.values(hass.entities ?? {})) {
    if (entry.device_id !== deviceId) continue;
    const stateObj = hass.states[entry.entity_id] as HassEntity | undefined;
    if (stateObj) out.push(stateObj);
  }
  return out;
};

// Match on the full `_<key>` suffix so `stats_packets_tx` never picks up
// `stats_packets_tx_relayed`.
export const findByKey = (entities: readonly HassEntity[], key: string): HassEntity | undefined =>
  entities.find((e) => e.entity_id.endsWith(`_${key}`));

export const resolveGateway = (hass: HomeAssistant, gatewayEntityId: string): GatewayContext | undefined => {
  const gateway = hass.states[gatewayEntityId] as HassEntity | undefined;
  if (!gateway) return undefined;
  const entry = hass.entities?.[gatewayEntityId];
  const deviceId = entry?.device_id ?? undefined;
  const device = deviceId ? hass.devices?.[deviceId] : undefined;
  return { gateway, deviceId, device, entities: deviceId ? findDeviceEntities(hass, deviceId) : [] };
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const isMissing = (state: string | undefined): boolean =>
  state === undefined || state === '' || state === 'unavailable' || state === 'unknown';

const toNumber = (state: string): number | undefined => {
  if (state.trim() === '') return undefined;
  const n = Number(state);
  return Number.isFinite(n) ? n : undefined;
};

export const formatNumber = (value: number): string => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

// State plus unit, e.g. `4.12 V`; `—` when unavailable.
export const formatState = (entity: HassEntity | undefined, withUnit = true): string => {
  if (!entity || isMissing(entity.state)) return NO_VALUE;
  const n = toNumber(entity.state);
  const value = n === undefined ? entity.state : formatNumber(n);
  const unit = withUnit ? entity.attributes.unit_of_measurement : undefined;
  return unit ? `${value} ${unit}` : value;
};

// `3d 4h 12m`; seconds only below a minute.
export const formatUptime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return NO_VALUE;
  const s = Math.floor(seconds);
  if (s < 60) return `${String(s)}s`;
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${String(d)}d`);
  if (h > 0) parts.push(`${String(h)}h`);
  if (m > 0 || parts.length === 0) parts.push(`${String(m)}m`);
  return parts.join(' ');
};

const formatUptimeState = (entity: HassEntity): string => {
  if (isMissing(entity.state)) return NO_VALUE;
  const n = toNumber(entity.state);
  if (n === undefined) return entity.state;
  const unit = entity.attributes.unit_of_measurement ?? 's';
  return formatUptime(n * (UNIT_SECONDS[unit] ?? 1));
};

// Protobuf enum names to display text: `LONG_FAST` → `Long Fast`.
export const formatEnum = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value === '') return undefined;
  return value
    .split('_')
    .filter((w) => w !== '')
    .map((w) => (ACRONYMS.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
};

const formatString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const formatBool = (value: unknown): string | undefined => {
  if (typeof value !== 'boolean') return undefined;
  return value ? 'On' : 'Off';
};

const formatInt = (value: unknown, zeroLabel?: string, unit?: string): string | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value === 0 && zeroLabel) return zeroLabel;
  return unit ? `${String(value)} ${unit}` : String(value);
};

const displayName = (device: HomeAssistantDevice | undefined): string | undefined =>
  device?.name_by_user ?? device?.name ?? undefined;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface RowSpec {
  key: string;
  label: string;
  value: string | undefined;
  // Read from the gateway's config attributes (hidden by `show_config: false`).
  config?: boolean;
}

const sensorRow = (ctx: GatewayContext, key: string, label: string): RowSpec => {
  const entity = findByKey(ctx.entities, key);
  return { key, label, value: entity ? formatState(entity) : undefined };
};

const configRow = (key: string, label: string, value: string | undefined): RowSpec => ({
  key: `config:${key}`,
  label,
  value,
  config: true,
});

const deviceRows = (ctx: GatewayContext, attr: (name: string) => unknown): RowSpec[] => {
  const battery = findByKey(ctx.entities, 'device_battery_level');
  let batteryValue: string | undefined;
  if (battery) {
    batteryValue = formatState(battery);
    if (batteryValue !== NO_VALUE && findByKey(ctx.entities, 'device_powered')?.state === 'on') {
      batteryValue += ' · Powered';
    }
  }
  const uptime = findByKey(ctx.entities, 'device_uptime');
  return [
    { key: 'device_battery_level', label: 'Battery', value: batteryValue },
    sensorRow(ctx, 'device_voltage', 'Voltage'),
    { key: 'device_uptime', label: 'Uptime', value: uptime ? formatUptimeState(uptime) : undefined },
    { key: 'node_id', label: 'Node ID', value: ctx.device?.serial_number ?? undefined },
    configRow('role', 'Role', formatEnum(attr('config_device_role'))),
    configRow('rebroadcast', 'Rebroadcast', formatEnum(attr('config_device_rebroadcastMode'))),
    configRow('bluetooth', 'Bluetooth', formatBool(attr('config_bluetooth_enabled'))),
    configRow('wifi', 'Wi-Fi', formatBool(attr('config_network_wifiEnabled'))),
  ];
};

const modemPreset = (attr: (name: string) => unknown): string | undefined => {
  if (attr('config_lora_usePreset') === false) {
    const parts = ['Custom'];
    const bw = formatInt(attr('config_lora_bandwidth'), undefined, 'kHz');
    const sf = formatInt(attr('config_lora_spreadFactor'));
    const cr = formatInt(attr('config_lora_codingRate'));
    if (bw) parts.push(bw);
    if (sf) parts.push(`SF${sf}`);
    if (cr) parts.push(`CR 4/${cr}`);
    return parts.join(' · ');
  }
  return formatEnum(attr('config_lora_modemPreset'));
};

const radioRows = (ctx: GatewayContext, attr: (name: string) => unknown): RowSpec[] => [
  sensorRow(ctx, 'device_channel_utilization', 'Channel util.'),
  sensorRow(ctx, 'device_airtime', 'Airtime TX'),
  configRow('region', 'Region', formatString(attr('config_lora_region'))),
  configRow('preset', 'Modem preset', modemPreset(attr)),
  configRow('tx_power', 'TX power', formatInt(attr('config_lora_txPower'), 'Default', 'dBm')),
  configRow('tx_enabled', 'Transmit', formatBool(attr('config_lora_txEnabled'))),
  configRow('hop_limit', 'Hop limit', formatInt(attr('config_lora_hopLimit'))),
  configRow('channel_num', 'Frequency slot', formatInt(attr('config_lora_channelNum'), 'Default')),
];

const meshRows = (ctx: GatewayContext): RowSpec[] => {
  const online = findByKey(ctx.entities, 'stats_nodes_online');
  const total = findByKey(ctx.entities, 'stats_nodes_total');
  const parts: string[] = [];
  if (online) parts.push(`${formatState(online, false)} online`);
  if (total) parts.push(`${formatState(total, false)} total`);
  return [{ key: 'nodes', label: 'Nodes', value: parts.length > 0 ? parts.join(' / ') : undefined }];
};

const trafficRows = (ctx: GatewayContext): RowSpec[] => [
  sensorRow(ctx, 'stats_packets_tx', 'Sent'),
  sensorRow(ctx, 'stats_packets_rx', 'Received'),
  sensorRow(ctx, 'stats_packets_tx_relayed', 'Relayed'),
  sensorRow(ctx, 'stats_packets_tx_relay_cancelled', 'Relay canceled'),
  sensorRow(ctx, 'stats_packets_rx_duplicate', 'Duplicates'),
  sensorRow(ctx, 'stats_packets_rx_bad', 'Malformed'),
];

// Environment, air quality and power telemetry, labelled by their friendly
// name minus the device name prefix ("Base Station Temperature" → "Temperature").
const environmentRows = (ctx: GatewayContext): RowSpec[] => {
  const prefix = displayName(ctx.device);
  return ctx.entities
    .filter((e) => GENERIC_SENSOR_RE.test(e.entity_id))
    .map((e) => {
      const friendly = e.attributes.friendly_name ?? e.entity_id;
      const label = prefix && friendly.startsWith(`${prefix} `) ? friendly.slice(prefix.length + 1) : friendly;
      return { key: e.entity_id, label, value: formatState(e) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
};

const positionRows = (ctx: GatewayContext, attr: (name: string) => unknown): RowSpec[] => {
  const tracker = findByKey(ctx.entities, 'node_position');
  let location: string | undefined;
  let altitude: string | undefined;
  let sats: string | undefined;
  if (tracker) {
    const { latitude, longitude } = tracker.attributes as { latitude?: unknown; longitude?: unknown };
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      location = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    } else if (isMissing(tracker.state)) {
      location = NO_VALUE;
    }
    altitude = formatInt(tracker.attributes.altitude, undefined, 'm');
    sats = formatInt(tracker.attributes.satsInView);
  }
  return [
    { key: 'location', label: 'Location', value: location },
    { key: 'altitude', label: 'Altitude', value: altitude },
    { key: 'satellites', label: 'Satellites', value: sats },
    configRow('gps_mode', 'GPS', formatEnum(attr('config_position_gpsMode'))),
    configRow('fixed_position', 'Fixed position', formatBool(attr('config_position_fixedPosition'))),
  ];
};

const moduleRows = (attr: (name: string) => unknown): RowSpec[] => {
  const known = MODULES.filter(([id]) => typeof attr(`module_${id}_enabled`) === 'boolean');
  if (known.length === 0) return [];
  const enabled = known.filter(([id]) => attr(`module_${id}_enabled`) === true).map(([, label]) => label);
  return [configRow('modules', 'Enabled', enabled.length > 0 ? enabled.join(' · ') : 'None')];
};

export const buildRadioSections = (
  ctx: GatewayContext,
  config: Pick<RadioCardConfig, 'sections' | 'show_config'>,
): RadioSection[] => {
  const attr = (name: string): unknown => ctx.gateway.attributes[name];
  const wanted = new Set<RadioSectionId>(config.sections ?? RADIO_SECTIONS);
  const showConfig = config.show_config !== false;

  const specs: Record<RadioSectionId, () => RowSpec[]> = {
    device: () => deviceRows(ctx, attr),
    radio: () => radioRows(ctx, attr),
    mesh: () => meshRows(ctx),
    traffic: () => trafficRows(ctx),
    environment: () => environmentRows(ctx),
    position: () => positionRows(ctx, attr),
    modules: () => moduleRows(attr),
  };

  const sections: RadioSection[] = [];
  for (const id of RADIO_SECTIONS) {
    if (!wanted.has(id)) continue;
    const rows: RadioRow[] = [];
    for (const spec of specs[id]()) {
      if (spec.value === undefined) continue;
      if (spec.config && !showConfig) continue;
      rows.push({ key: spec.key, label: spec.label, value: spec.value });
    }
    if (rows.length > 0) sections.push({ id, title: SECTION_TITLES[id], rows });
  }
  return sections;
};

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export const resolveTitle = (ctx: GatewayContext, config: Pick<RadioCardConfig, 'title'>): string => {
  if (config.title) return config.title;
  const name = displayName(ctx.device);
  if (name) return name;
  const longName = findByKey(ctx.entities, 'node_long_name');
  if (longName && !isMissing(longName.state)) return longName.state;
  return ctx.gateway.attributes.friendly_name ?? ctx.gateway.entity_id;
};

// `BASE · T-Beam · v2.5.6`, plus `Disconnected` when the gateway is unavailable.
export const buildHeaderMeta = (ctx: GatewayContext): string => {
  const parts: string[] = [];
  const shortName = findByKey(ctx.entities, 'node_short_name');
  if (shortName && !isMissing(shortName.state)) parts.push(shortName.state);
  if (ctx.device?.model) parts.push(ctx.device.model);
  if (ctx.device?.sw_version) parts.push(`v${ctx.device.sw_version}`);
  if (ctx.gateway.state === 'unavailable') parts.push('Disconnected');
  return parts.join(' · ');
};
