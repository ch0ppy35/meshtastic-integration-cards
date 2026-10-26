import { LitElement, html, nothing, type TemplateResult, type CSSResultGroup, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { sharedStyles } from './styles';
import { radioStyles } from './radio-styles';
import { type HomeAssistant } from './ha-types';
import { RADIO_SECTIONS, type RadioCardConfig } from './types';
import { pickDefaultGatewayEntity } from './discovery';
import {
  SECTION_TITLES,
  assertRadioConfig,
  buildHeaderMeta,
  buildRadioSections,
  resolveGateway,
  resolveTitle,
  type GatewayContext,
  type RadioRow,
  type RadioSection,
} from './radio';
import { registerCard } from './register';

const cardTag = registerCard({
  id: 'meshtastic-radio-card',
  name: 'Meshtastic Radio',
  description: 'Show telemetry, traffic and LoRa config for the Meshtastic gateway radio connected to Home Assistant.',
});

@customElement(cardTag)
export class MeshtasticRadioCard extends LitElement {
  @property({ attribute: false }) accessor hass!: HomeAssistant;

  @state() accessor _config: RadioCardConfig | undefined = undefined;

  private _ctx?: GatewayContext;
  private _sections: RadioSection[] = [];
  // Last rendered value per row key, used to flash rows whose value changed.
  private _previous?: Map<string, string>;
  private _previousEntity?: string;
  private _flashKeys = new Set<string>();

  // Use the built-in form editor (https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card#using-the-built-in-form-editor).
  static getConfigForm() {
    return {
      schema: [
        {
          name: 'gateway_entity',
          required: true,
          selector: { entity: { domain: 'meshtastic', device_class: 'gateway' } },
        },
        { name: 'title', selector: { text: {} } },
        {
          name: 'sections',
          selector: {
            select: {
              multiple: true,
              mode: 'list',
              options: RADIO_SECTIONS.map((id) => ({ value: id, label: SECTION_TITLES[id] })),
            },
          },
        },
        { name: 'show_config', selector: { boolean: {} } },
      ],
      assertConfig: (config: RadioCardConfig) => {
        assertRadioConfig(config);
      },
    };
  }

  static getStubConfig(hass: HomeAssistant): Partial<RadioCardConfig> {
    return {
      gateway_entity: pickDefaultGatewayEntity(hass) ?? '',
      show_config: true,
    };
  }

  public setConfig(config?: RadioCardConfig) {
    assertRadioConfig(config);
    this._config = { show_config: true, ...config };
  }

  // Masonry view sizing: roughly 50px per unit; each row is ~25px.
  public getCardSize() {
    const rows = this._sections.reduce((n, s) => n + s.rows.length + 1, 0);
    return Math.max(3, Math.ceil(rows / 2) + 1);
  }

  // Sections view sizing
  // (https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card#sizing-in-sections-view).
  public getGridOptions() {
    return { rows: 'auto', columns: 6, min_columns: 4 };
  }

  static get styles(): CSSResultGroup {
    return [sharedStyles, radioStyles];
  }

  protected willUpdate(changed: PropertyValues): void {
    if (!changed.has('hass') && !changed.has('_config')) return;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!this.hass || !this._config) return;

    const target = this._config.gateway_entity;
    this._ctx = resolveGateway(this.hass, target);
    this._sections = this._ctx ? buildRadioSections(this._ctx, this._config) : [];

    const values = new Map<string, string>();
    for (const section of this._sections) {
      for (const row of section.rows) values.set(row.key, row.value);
    }
    // Only flash on live updates of the same gateway, never on first render.
    if (this._previous && this._previousEntity === target) {
      const previous = this._previous;
      const flashed = [...values].filter(([key, value]) => previous.has(key) && previous.get(key) !== value);
      if (flashed.length > 0) this._flash(flashed.map(([key]) => key));
    }
    this._previous = values;
    this._previousEntity = target;
  }

  private _flash(keys: string[]): void {
    for (const key of keys) this._flashKeys.add(key);
    // A little longer than the 1.2s `flash` keyframe in styles.ts, matching
    // the chat card.
    setTimeout(() => {
      let cleared = false;
      for (const key of keys) {
        if (this._flashKeys.delete(key)) cleared = true;
      }
      if (cleared) this.requestUpdate();
    }, 1300);
  }

  private _flashClass(row: RadioRow): string {
    return this._flashKeys.has(row.key) ? 'live-flash' : '';
  }

  private _renderRows(section: RadioSection): TemplateResult {
    if (section.id === 'traffic') {
      return html`
        <div class="traffic">
          ${repeat(
            section.rows,
            (r) => r.key,
            (r) => html`
              <div class="cell ${this._flashClass(r)}">
                <span class="label">${r.label}</span>
                <span class="value">${r.value}</span>
              </div>
            `,
          )}
        </div>
      `;
    }
    return html`${repeat(
      section.rows,
      (r) => r.key,
      (r) => html`
        <div class="row ${this._flashClass(r)}">
          <span class="label">${r.label}</span>
          <span class="value">${r.value}</span>
        </div>
      `,
    )}`;
  }

  protected render(): TemplateResult {
    if (!this._config) {
      return html`<ha-card><div class="error">Card not configured.</div></ha-card>`;
    }
    const ctx = this._ctx;
    if (!ctx) {
      return html`
        <ha-card>
          <div class="header"><div class="title">${this._config.title ?? 'Meshtastic Radio'}</div></div>
          <div class="error">Gateway entity not found: ${this._config.gateway_entity}</div>
        </ha-card>
      `;
    }

    return html`
      <ha-card>
        <div class="header">
          <div class="title">${resolveTitle(ctx, this._config)}</div>
          <div class="meta">${buildHeaderMeta(ctx)}</div>
        </div>
        ${
          ctx.deviceId
            ? nothing
            : html`<div class="error">No device found for ${this._config.gateway_entity}; only config is shown.</div>`
        }
        <div class="sections">
          ${this._sections.length === 0 ? html`<div class="empty">No radio data yet.</div>` : nothing}
          ${repeat(
            this._sections,
            (s) => s.id,
            (s) => html`
              <div class="section-title">${s.title}</div>
              ${this._renderRows(s)}
            `,
          )}
        </div>
      </ha-card>
    `;
  }
}
