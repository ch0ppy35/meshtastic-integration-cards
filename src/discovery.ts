import { type HassEntity } from 'home-assistant-js-websocket';

import { type HomeAssistant } from './ha-types';
import type { MeshtasticChannelStateAttrs, MeshtasticGatewayStateAttrs } from './types';

// A channel state entry as returned by hass.states. We only narrow the
// attributes we care about.
export type ChannelState = HassEntity & {
  attributes: HassEntity['attributes'] & MeshtasticChannelStateAttrs;
};

// All channel entities exposed by the meshtastic integration.
export const listChannelStates = (hass: HomeAssistant): ChannelState[] => {
  return Object.values(hass.states).filter((s): s is ChannelState => {
    const attrs = s.attributes as MeshtasticChannelStateAttrs;
    return attrs.device_class === 'channel' && typeof s.entity_id === 'string' && s.entity_id.startsWith('meshtastic.');
  });
};

// Resolve the gateway display name for a channel state.
// Falls back to the channel's friendly_name prefix and then to the node id.
export const resolveGatewayName = (hass: HomeAssistant, channel: ChannelState): string => {
  const friendly = channel.attributes.friendly_name ?? '';
  // The integration formats channel friendly_names as
  // "<gateway long_name> Channel <name>" (or "Primary"/"Secondary").
  const channelMarker = ' Channel ';
  const idx = friendly.indexOf(channelMarker);
  if (idx > 0) {
    return friendly.slice(0, idx);
  }

  const node = channel.attributes.node;
  if (node !== undefined) {
    return `Gateway ${String(node)}`;
  }

  // As a last resort try the device registry on the hass object.
  if (hass.devices) {
    for (const dev of Object.values(hass.devices)) {
      const name = dev.name_by_user ?? dev.name;
      if (name) {
        return name;
      }
    }
  }
  return friendly || channel.entity_id;
};

// Resolve the channel display name (e.g. "Primary", "Secondary", "LongFast").
export const resolveChannelName = (channel: ChannelState): string => {
  const friendly = channel.attributes.friendly_name ?? '';
  const channelMarker = ' Channel ';
  const idx = friendly.indexOf(channelMarker);
  if (idx > 0) {
    return friendly.slice(idx + channelMarker.length);
  }
  if (channel.attributes.primary) return 'Primary';
  if (channel.attributes.secondary) return 'Secondary';
  if (typeof channel.attributes.index === 'number') return `Channel ${String(channel.attributes.index)}`;
  return friendly || channel.entity_id;
};

// Pick a sensible default channel entity for `getStubConfig`.
export const pickDefaultChannelEntity = (hass: HomeAssistant): string | undefined => {
  const channels = listChannelStates(hass);
  if (channels.length === 0) return undefined;
  // Prefer the primary channel if present.
  const primary = channels.find((c) => c.attributes.primary === true);
  return (primary ?? channels[0]).entity_id;
};

// All gateway entities exposed by the meshtastic integration (one per
// connected radio).
export const listGatewayStates = (hass: HomeAssistant): HassEntity[] => {
  return Object.values(hass.states).filter((s) => {
    const attrs = s.attributes as MeshtasticGatewayStateAttrs;
    return attrs.device_class === 'gateway' && typeof s.entity_id === 'string' && s.entity_id.startsWith('meshtastic.');
  });
};

// Pick a sensible default gateway entity for `getStubConfig`.
export const pickDefaultGatewayEntity = (hass: HomeAssistant): string | undefined => {
  return listGatewayStates(hass).at(0)?.entity_id;
};
