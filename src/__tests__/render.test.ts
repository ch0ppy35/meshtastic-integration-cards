// Lit + jsdom render test for MeshtasticChatCard. This is intentionally a
// minimal smoke test: we mount the card with a stubbed `hass`, fire a fake
// `meshtastic_message_log` event through our stub `subscribeEvents`, and
// assert that a row appears in the rendered output.

import { beforeAll, describe, expect, it, vi, type Mock } from 'vitest';

import type { HomeAssistant } from '../ha-types.js';
import type { MeshtasticMessageLogEvent } from '../types.js';

type SubscribeEventsFn = (cb: (event: MeshtasticMessageLogEvent) => void, eventType: string) => Promise<() => void>;

interface FakeConnection {
  subscribeEvents: Mock<SubscribeEventsFn>;
  emit: (event: MeshtasticMessageLogEvent) => void;
}

const makeConnection = (): FakeConnection => {
  let listener: ((event: MeshtasticMessageLogEvent) => void) | undefined;
  const subscribeEvents = vi.fn<SubscribeEventsFn>().mockImplementation((cb) => {
    listener = cb;
    return Promise.resolve(() => undefined);
  });
  return {
    subscribeEvents,
    emit: (event) => {
      listener?.(event);
    },
  };
};

const makeHass = (conn: FakeConnection): HomeAssistant => ({
  states: {
    'meshtastic.ch': {
      entity_id: 'meshtastic.ch',
      state: 'idle',
      attributes: { device_class: 'channel', friendly_name: 'My Channel' },
      last_changed: '',
      last_updated: '',
      context: { id: '', user_id: null, parent_id: null },
    },
  },
  callWS: vi.fn(() => Promise.resolve([])) as unknown as HomeAssistant['callWS'],
  callService: vi.fn(),
  connection: conn as unknown as HomeAssistant['connection'],
});

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

describe('MeshtasticChatCard render', () => {
  beforeAll(async () => {
    // Importing the module registers the custom element with the global
    // customElements registry. We do this once for the whole file.
    await import('../index.js');
  });

  it('registers the meshtastic-chat-card custom element', () => {
    expect(customElements.get('meshtastic-chat-card')).toBeDefined();
  });

  it('renders the channel friendly_name as the header title', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);

    const el = document.createElement('meshtastic-chat-card') as HTMLElement & {
      hass: HomeAssistant;
      setConfig: (cfg: Record<string, unknown>) => void;
      updateComplete: Promise<boolean>;
    };
    el.setConfig({ channel_entity: 'meshtastic.ch' });
    el.hass = hass;
    document.body.appendChild(el);

    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const title = el.shadowRoot?.querySelector('.title');
    expect(title?.textContent).toContain('My Channel');

    document.body.removeChild(el);
  });

  it('renders a row when a live meshtastic_message_log event arrives', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);

    const el = document.createElement('meshtastic-chat-card') as HTMLElement & {
      hass: HomeAssistant;
      setConfig: (cfg: Record<string, unknown>) => void;
      updateComplete: Promise<boolean>;
    };
    el.setConfig({ channel_entity: 'meshtastic.ch' });
    el.hass = hass;
    document.body.appendChild(el);

    // Wait for the initial subscribe + history call to settle.
    await el.updateComplete;
    await flush();
    await el.updateComplete;
    await flush();

    expect(conn.subscribeEvents).toHaveBeenCalled();

    conn.emit({
      event_type: 'meshtastic_message_log',
      data: {
        entity_id: 'meshtastic.ch',
        from_name: 'Alice',
        message: 'hello mesh',
        pki: false,
      },
      time_fired: '2023-05-01T12:00:00.000Z',
      context: { id: 'ctx-1', user_id: null, parent_id: null },
    });

    await flush();
    await el.updateComplete;

    const rows = el.shadowRoot?.querySelectorAll('.row') ?? [];
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toContain('Alice');
    expect(rows[0]?.textContent).toContain('hello mesh');

    document.body.removeChild(el);
  });

  it('always renders the lock badge when a message has pki: true', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);

    const el = document.createElement('meshtastic-chat-card') as HTMLElement & {
      hass: HomeAssistant;
      setConfig: (cfg: Record<string, unknown>) => void;
      updateComplete: Promise<boolean>;
    };
    el.setConfig({ channel_entity: 'meshtastic.ch' });
    el.hass = hass;
    document.body.appendChild(el);

    await el.updateComplete;
    await flush();
    await el.updateComplete;
    await flush();

    conn.emit({
      event_type: 'meshtastic_message_log',
      data: {
        entity_id: 'meshtastic.ch',
        from_name: 'Bob',
        message: 'secret',
        pki: true,
      },
      time_fired: '2023-05-01T12:01:00.000Z',
      context: { id: 'ctx-2', user_id: null, parent_id: null },
    });

    await flush();
    await el.updateComplete;

    const lock = el.shadowRoot?.querySelector('.row .pki');
    expect(lock).toBeTruthy();
    expect(lock?.textContent).toContain('🔒');

    document.body.removeChild(el);
  });

  it('does not render the composer by default', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);

    const el = document.createElement('meshtastic-chat-card') as HTMLElement & {
      hass: HomeAssistant;
      setConfig: (cfg: Record<string, unknown>) => void;
      updateComplete: Promise<boolean>;
    };
    el.setConfig({ channel_entity: 'meshtastic.ch' });
    el.hass = hass;
    document.body.appendChild(el);

    await el.updateComplete;
    await flush();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('.composer')).toBeNull();

    document.body.removeChild(el);
  });

  it('renders the composer when enable_send is true', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);

    const el = document.createElement('meshtastic-chat-card') as HTMLElement & {
      hass: HomeAssistant;
      setConfig: (cfg: Record<string, unknown>) => void;
      updateComplete: Promise<boolean>;
    };
    el.setConfig({ channel_entity: 'meshtastic.ch', enable_send: true });
    el.hass = hass;
    document.body.appendChild(el);

    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const composer = el.shadowRoot?.querySelector('.composer');
    expect(composer).toBeTruthy();
    expect(composer?.querySelector('.composer-input')).toBeTruthy();
    expect(composer?.querySelector('.composer-send')).toBeTruthy();

    document.body.removeChild(el);
  });

  it('sends a broadcast_channel_message and clears the input on success', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const callService = hass.callService as unknown as Mock;
    callService.mockReturnValue(Promise.resolve());

    const el = document.createElement('meshtastic-chat-card') as HTMLElement & {
      hass: HomeAssistant;
      setConfig: (cfg: Record<string, unknown>) => void;
      updateComplete: Promise<boolean>;
    };
    el.setConfig({ channel_entity: 'meshtastic.ch', enable_send: true });
    el.hass = hass;
    document.body.appendChild(el);

    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const input = el.shadowRoot?.querySelector<HTMLInputElement>('.composer-input');
    const button = el.shadowRoot?.querySelector<HTMLButtonElement>('.composer-send');
    expect(input).toBeTruthy();
    expect(button).toBeTruthy();

    if (!input || !button) throw new Error('composer not found');

    input.value = 'hello world';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;

    expect(button.disabled).toBe(false);

    button.click();
    await flush();
    await el.updateComplete;

    expect(callService).toHaveBeenCalledWith('meshtastic', 'broadcast_channel_message', {
      channel: 'meshtastic.ch',
      message: 'hello world',
      ack: true,
    });

    const inputAfter = el.shadowRoot?.querySelector<HTMLInputElement>('.composer-input');
    expect(inputAfter?.value).toBe('');

    document.body.removeChild(el);
  });

  it("shows a sent message once, from the integration's outbound log event", async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);
    (hass.callService as unknown as Mock).mockReturnValue(Promise.resolve());

    const el = document.createElement('meshtastic-chat-card') as HTMLElement & {
      hass: HomeAssistant;
      setConfig: (cfg: Record<string, unknown>) => void;
      updateComplete: Promise<boolean>;
    };
    el.setConfig({ channel_entity: 'meshtastic.ch', enable_send: true });
    el.hass = hass;
    document.body.appendChild(el);

    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const input = el.shadowRoot?.querySelector<HTMLInputElement>('.composer-input');
    const button = el.shadowRoot?.querySelector<HTMLButtonElement>('.composer-send');
    if (!input || !button) throw new Error('composer not found');

    input.value = 'optimistic hi';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;

    button.click();
    await flush();
    await el.updateComplete;

    // The card no longer echoes locally: nothing until the integration reports the send.
    expect(el.shadowRoot?.querySelectorAll('.row').length).toBe(0);

    conn.emit({
      event_type: 'meshtastic_message_log',
      data: {
        entity_id: 'meshtastic.ch',
        from_name: 'ChopMesh1 (!756f9ad8)',
        message: 'optimistic hi',
        direction: 'out',
        to_name: 'My Channel',
      },
      time_fired: '2023-05-01T12:00:00.000Z',
      context: { id: 'ctx-out', user_id: null, parent_id: null },
    });
    await el.updateComplete;

    const rows = el.shadowRoot?.querySelectorAll('.row') ?? [];
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toContain('You');
    expect(rows[0]?.textContent).toContain('optimistic hi');

    document.body.removeChild(el);
  });

  it('does not append a row when the send fails', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);
    (hass.callService as unknown as Mock).mockImplementation(() => Promise.reject(new Error('boom')));

    const el = document.createElement('meshtastic-chat-card') as HTMLElement & {
      hass: HomeAssistant;
      setConfig: (cfg: Record<string, unknown>) => void;
      updateComplete: Promise<boolean>;
    };
    el.setConfig({ channel_entity: 'meshtastic.ch', enable_send: true });
    el.hass = hass;
    document.body.appendChild(el);

    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const input = el.shadowRoot?.querySelector<HTMLInputElement>('.composer-input');
    const button = el.shadowRoot?.querySelector<HTMLButtonElement>('.composer-send');
    if (!input || !button) throw new Error('composer not found');

    input.value = 'will fail';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;

    button.click();
    await flush();
    await el.updateComplete;

    const rows = el.shadowRoot?.querySelectorAll('.row') ?? [];
    expect(rows.length).toBe(0);

    document.body.removeChild(el);
  });

  it('does not send when the input is empty or only whitespace', async () => {
    const conn = makeConnection();
    const hass = makeHass(conn);
    (hass.callService as unknown as Mock).mockReturnValue(Promise.resolve());

    const el = document.createElement('meshtastic-chat-card') as HTMLElement & {
      hass: HomeAssistant;
      setConfig: (cfg: Record<string, unknown>) => void;
      updateComplete: Promise<boolean>;
    };
    el.setConfig({ channel_entity: 'meshtastic.ch', enable_send: true });
    el.hass = hass;
    document.body.appendChild(el);

    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const input = el.shadowRoot?.querySelector<HTMLInputElement>('.composer-input');
    const button = el.shadowRoot?.querySelector<HTMLButtonElement>('.composer-send');
    if (!input || !button) throw new Error('composer not found');

    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;

    expect(button.disabled).toBe(true);

    document.body.removeChild(el);
  });
});
