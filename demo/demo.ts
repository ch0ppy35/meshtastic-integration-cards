// Static demo harness for <meshtastic-chat-card-dev>. Builds a fake
// HomeAssistant object, wires a controls panel to the card's config, and lets
// you inject fake live messages so the UI can be exercised without HA.

import type { Connection, HassEntity } from 'home-assistant-js-websocket';
import type { HomeAssistant } from '../src/ha-types';
import type { ChatCardConfig, LogbookEntry, MeshtasticMessageLogEvent } from '../src/types';

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

const main = (): void => {
  const host = $('card-host') as HTMLDivElement;

  const state: DemoState = {
    history: buildHistory(8),
    emit: () => undefined,
  };
  const hass = makeFakeHass(state);

  const mountCard = (): CardEl => {
    host.replaceChildren();
    const el = document.createElement('meshtastic-chat-card-dev') as CardEl;
    el.setConfig(readConfig());
    el.hass = hass;
    host.appendChild(el);
    return el;
  };

  let card = mountCard();

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
