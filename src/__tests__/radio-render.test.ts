// Lit + jsdom render tests for MeshtasticRadioCard: mount it with a fake
// gateway device, check the header and sections, then push a state change
// through `hass` and check the changed row flashes.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { HomeAssistant } from '../ha-types.js';
import type { RadioCardConfig } from '../types.js';
import { GATEWAY_ENTITY, SECRETS, makeRadioHass, makeState, sensorId } from './fixtures/radio.js';

type RadioCardEl = HTMLElement & {
  hass: HomeAssistant;
  setConfig: (cfg: Partial<RadioCardConfig>) => void;
  getCardSize: () => number;
  updateComplete: Promise<boolean>;
};

interface RadioCardStatics {
  getStubConfig: (hass: HomeAssistant) => Partial<RadioCardConfig>;
  getConfigForm: () => { schema: { name: string }[]; assertConfig: (c: Partial<RadioCardConfig>) => void };
}

const mount = async (config: Partial<RadioCardConfig>, hass: HomeAssistant = makeRadioHass()): Promise<RadioCardEl> => {
  const el = document.createElement('meshtastic-radio-card') as RadioCardEl;
  el.setConfig(config);
  el.hass = hass;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
};

const rowByLabel = (el: RadioCardEl, label: string): Element | undefined =>
  [...(el.shadowRoot?.querySelectorAll('.row, .cell') ?? [])].find(
    (r) => r.querySelector('.label')?.textContent.trim() === label,
  );

describe('MeshtasticRadioCard render', () => {
  beforeAll(async () => {
    await import('../radio-card.js');
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('registers the meshtastic-radio-card custom element', () => {
    expect(customElements.get('meshtastic-radio-card')).toBeDefined();
    expect(window.customCards?.some((c) => c.type === 'meshtastic-radio-card')).toBe(true);
  });

  it('renders the device name and meta in the header', async () => {
    const el = await mount({ gateway_entity: GATEWAY_ENTITY });
    expect(el.shadowRoot?.querySelector('.header .title')?.textContent).toContain('Base Station');
    expect(el.shadowRoot?.querySelector('.header .meta')?.textContent).toContain('BASE · T-Beam · v2.5.6.abc123');
  });

  it('prefers the configured title', async () => {
    const el = await mount({ gateway_entity: GATEWAY_ENTITY, title: 'Roof Radio' });
    expect(el.shadowRoot?.querySelector('.header .title')?.textContent).toContain('Roof Radio');
  });

  it('renders section titles and values', async () => {
    const el = await mount({ gateway_entity: GATEWAY_ENTITY });
    const titles = [...(el.shadowRoot?.querySelectorAll('.section-title') ?? [])].map((t) => t.textContent.trim());
    expect(titles).toEqual(['Device', 'Radio', 'Mesh', 'Traffic', 'Sensors', 'Position', 'Modules']);
    expect(rowByLabel(el, 'Battery')?.textContent).toContain('87 %');
    expect(rowByLabel(el, 'Modem preset')?.textContent).toContain('Long Fast');
    expect(rowByLabel(el, 'Relayed')?.classList.contains('cell')).toBe(true);
    expect(el.getCardSize()).toBeGreaterThan(3);
  });

  it('never puts secrets in the DOM', async () => {
    const el = await mount({ gateway_entity: GATEWAY_ENTITY });
    const html = el.shadowRoot?.innerHTML ?? '';
    for (const value of Object.values(SECRETS).flat()) expect(html).not.toContain(value);
  });

  it('flashes only the rows whose value changed on a hass update', async () => {
    const el = await mount({ gateway_entity: GATEWAY_ENTITY });
    expect(el.shadowRoot?.querySelectorAll('.live-flash').length).toBe(0);

    const id = sensorId('device_battery_level');
    el.hass = makeRadioHass({ states: { [id]: makeState(id, '64', { unit_of_measurement: '%' }) } });
    await el.updateComplete;

    const battery = rowByLabel(el, 'Battery');
    expect(battery?.textContent).toContain('64 %');
    expect(battery?.classList.contains('live-flash')).toBe(true);
    expect(el.shadowRoot?.querySelectorAll('.live-flash').length).toBe(1);
  });

  it('clears the flash after the animation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const el = await mount({ gateway_entity: GATEWAY_ENTITY });
      const id = sensorId('device_voltage');
      el.hass = makeRadioHass({ states: { [id]: makeState(id, '3.90', { unit_of_measurement: 'V' }) } });
      await el.updateComplete;
      expect(rowByLabel(el, 'Voltage')?.classList.contains('live-flash')).toBe(true);

      vi.advanceTimersByTime(1300);
      await el.updateComplete;
      expect(rowByLabel(el, 'Voltage')?.classList.contains('live-flash')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a placeholder before it is configured', async () => {
    const el = document.createElement('meshtastic-radio-card') as RadioCardEl;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('.error')?.textContent).toContain('Card not configured.');
  });

  it('sizes itself for the sections view', () => {
    const el = document.createElement('meshtastic-radio-card') as RadioCardEl & {
      getGridOptions: () => Record<string, unknown>;
    };
    expect(el.getGridOptions()).toEqual({ rows: 'auto', columns: 6, min_columns: 4 });
  });

  it('does not flash when switching to a different gateway', async () => {
    const el = await mount({ gateway_entity: GATEWAY_ENTITY });
    const other = 'meshtastic.gateway_other';
    el.setConfig({ gateway_entity: other });
    el.hass = makeRadioHass({ states: { [other]: makeState(other, 'Connected', { device_class: 'gateway' }) } });
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll('.live-flash').length).toBe(0);
  });

  it('shows an error when the gateway entity is missing', async () => {
    const el = await mount({ gateway_entity: 'meshtastic.missing' });
    expect(el.shadowRoot?.querySelector('.error')?.textContent).toContain(
      'Gateway entity not found: meshtastic.missing',
    );
  });

  it('warns when the gateway has no device and still shows config', async () => {
    const el = await mount({ gateway_entity: GATEWAY_ENTITY }, makeRadioHass({ withoutRegistry: true }));
    expect(el.shadowRoot?.querySelector('.error')?.textContent).toContain('No device found');
    expect(rowByLabel(el, 'Region')?.textContent).toContain('US');
  });

  it('shows an empty state when there is nothing to show', async () => {
    const el = await mount(
      { gateway_entity: GATEWAY_ENTITY, show_config: false },
      makeRadioHass({ withoutRegistry: true }),
    );
    expect(el.shadowRoot?.querySelector('.empty')?.textContent).toContain('No radio data yet.');
  });

  it('setConfig rejects a config without gateway_entity', () => {
    const el = document.createElement('meshtastic-radio-card') as RadioCardEl;
    expect(() => {
      el.setConfig({});
    }).toThrow(/gateway_entity/);
  });

  it('getStubConfig picks the gateway and the form validates', () => {
    const Card = customElements.get('meshtastic-radio-card') as unknown as RadioCardStatics;
    expect(Card.getStubConfig(makeRadioHass()).gateway_entity).toBe(GATEWAY_ENTITY);
    const form = Card.getConfigForm();
    expect(form.schema.map((s) => s.name)).toEqual(['gateway_entity', 'title', 'sections', 'show_config']);
    expect(() => {
      form.assertConfig({});
    }).toThrow();
  });
});
