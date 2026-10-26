import type { Connection, HassEntity } from 'home-assistant-js-websocket';

// Subset of a device registry entry (`hass.devices[device_id]`).
export interface HomeAssistantDevice {
  id?: string;
  name?: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  model_id?: string | null;
  sw_version?: string | null;
  hw_version?: string | null;
  serial_number?: string | null;
}

// Subset of an entity registry display entry (`hass.entities[entity_id]`).
export interface HomeAssistantEntityEntry {
  entity_id: string;
  device_id?: string | null;
  platform?: string;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  connection: Connection;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;

  // Registries. Used for channel/gateway display fallbacks and to find the
  // sensors that belong to a gateway device.
  devices?: Record<string, HomeAssistantDevice>;
  entities?: Record<string, HomeAssistantEntityEntry>;
}
