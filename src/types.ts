// Mirrors the wire formats produced by the upstream `meshtastic`
// Home Assistant integration (see custom_components/meshtastic/{const,logbook}.py).

// ---------------------------------------------------------------------------
// Card config
// ---------------------------------------------------------------------------

export interface ChatCardConfig {
  type?: string;
  title?: string;
  channel_entity: string;
  limit?: number;
  show_timestamps?: boolean;
  sort_order?: 'asc' | 'desc';
  enable_send?: boolean;
}

export const DEFAULT_LIMIT = 200;
// Sender label for messages sent from Home Assistant through this gateway.
export const OUTBOUND_SENDER = 'You';
export const DEFAULT_HISTORY_DAYS = 7;

// ---------------------------------------------------------------------------
// Normalised message used for rendering
// ---------------------------------------------------------------------------

export interface ChatMessage {
  // Stable id used as a Lit `repeat` key and for de-duping.
  id: string;
  // ISO timestamp string.
  time: string;
  fromName: string;
  message: string;
  pki: boolean;
  // Source of the message, useful for debugging.
  source: 'history' | 'live';
}

// ---------------------------------------------------------------------------
// Meshtastic event payload (event type: `meshtastic_message_log`)
// ---------------------------------------------------------------------------

export const MESHTASTIC_MESSAGE_LOG_EVENT = 'meshtastic_message_log';

export interface MeshtasticMessageLogData {
  entity_id: string;
  device_id?: string | null;
  from_name: string;
  message: string;
  pki?: boolean;
  // `out` for messages sent from Home Assistant; absent/`in` for received ones.
  direction?: 'in' | 'out';
  to_name?: string;
}

export interface MeshtasticMessageLogEvent {
  event_type: typeof MESHTASTIC_MESSAGE_LOG_EVENT;
  data: MeshtasticMessageLogData;
  origin?: string;
  time_fired?: string;
  context?: { id?: string; user_id?: string | null; parent_id?: string | null };
}

// ---------------------------------------------------------------------------
// Logbook WS response
// ---------------------------------------------------------------------------

// `logbook/get_events` returns an array of LogbookEntry. Only the fields we
// actually use are typed here.
export interface LogbookEntry {
  when: number | string; // seconds (float) since epoch, or ISO string in some HA versions
  name?: string;
  message?: string;
  entity_id?: string;
  domain?: string;
  icon?: string;
  context_id?: string;
}

// ---------------------------------------------------------------------------
// Channel discovery
// ---------------------------------------------------------------------------

export interface MeshtasticChannelStateAttrs {
  device_class?: string;
  friendly_name?: string;
  index?: number;
  node?: number | string;
  primary?: boolean;
  secondary?: boolean;
}

// ---------------------------------------------------------------------------
// Radio card
// ---------------------------------------------------------------------------

export const RADIO_SECTIONS = ['device', 'radio', 'mesh', 'traffic', 'environment', 'position', 'modules'] as const;
export type RadioSectionId = (typeof RADIO_SECTIONS)[number];

export interface RadioCardConfig {
  type?: string;
  title?: string;
  // The gateway entity (`meshtastic.gateway_*`, device_class `gateway`).
  gateway_entity: string;
  // Sections to show, in the card's fixed order. Defaults to all.
  sections?: RadioSectionId[];
  // Show the allowlisted radio config read from the gateway entity.
  show_config?: boolean;
}

export interface MeshtasticGatewayStateAttrs {
  device_class?: string;
  friendly_name?: string;
}
