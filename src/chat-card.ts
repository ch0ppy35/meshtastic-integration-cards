import { LitElement, html, nothing, type TemplateResult, type CSSResultGroup, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { type HassEntity } from 'home-assistant-js-websocket';

import { chatStyles, sharedStyles } from './styles';
import { type HomeAssistant } from './ha-types';
import { DEFAULT_LIMIT, type ChatCardConfig, type ChatMessage } from './types';
import { loadHistory } from './history';
import { subscribeMessageLog, type Unsubscribe } from './live';
import { pickDefaultChannelEntity } from './discovery';
import { appendUnique, trimMessages } from './messages';
import { registerCard } from './register';

const cardTag = registerCard({
  id: 'meshtastic-chat-card',
  name: 'Meshtastic Chat',
  description: 'Display Meshtastic channel messages recorded by the meshtastic Home Assistant integration.',
});

@customElement(cardTag)
export class MeshtasticChatCard extends LitElement {
  @property({ attribute: false }) accessor hass!: HomeAssistant;

  @state() accessor _config: ChatCardConfig | undefined = undefined;
  @state() accessor _messages: ChatMessage[] = [];
  @state() accessor _error: string | undefined = undefined;
  @state() accessor _loading = false;
  @state() accessor _sortOverride: 'asc' | 'desc' | undefined = undefined;
  @state() accessor _draft = '';
  @state() accessor _sending = false;
  @state() accessor _sendError: string | undefined = undefined;

  private _unsubscribe?: Unsubscribe;
  private _subscribedEntity?: string;
  private _autoStick = true;
  private _scrollEl?: HTMLElement | null;
  private _flashIds = new Set<string>();

  // Use the built-in form editor (https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card#using-the-built-in-form-editor).
  // No bespoke editor element is needed.
  static getConfigForm() {
    return {
      schema: [
        {
          name: 'channel_entity',
          required: true,
          selector: { entity: { domain: 'meshtastic', device_class: 'channel' } },
        },
        { name: 'title', selector: { text: {} } },
        {
          name: 'limit',
          selector: { number: { min: 10, max: 1000, step: 10, mode: 'box' } },
        },
        { name: 'show_timestamps', selector: { boolean: {} } },
        { name: 'enable_send', selector: { boolean: {} } },
        {
          name: 'sort_order',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { value: 'asc', label: 'Oldest first' },
                { value: 'desc', label: 'Newest first' },
              ],
            },
          },
        },
      ],
      assertConfig: (config: ChatCardConfig) => {
        if (!config.channel_entity || typeof config.channel_entity !== 'string') {
          throw new Error('channel_entity is required');
        }
        if (config.limit !== undefined && (typeof config.limit !== 'number' || config.limit <= 0)) {
          throw new Error('limit must be a positive number');
        }
      },
    };
  }

  static getStubConfig(hass: HomeAssistant): Partial<ChatCardConfig> {
    const channel_entity = pickDefaultChannelEntity(hass);
    return {
      channel_entity: channel_entity ?? '',
      limit: DEFAULT_LIMIT,
      show_timestamps: true,
      sort_order: 'desc',
      enable_send: false,
    };
  }

  public setConfig(config?: ChatCardConfig) {
    if (!config) {
      throw new Error('Invalid configuration.');
    }
    if (!config.channel_entity || typeof config.channel_entity !== 'string') {
      throw new Error('You need to set `channel_entity` (a meshtastic channel entity).');
    }
    if (config.limit !== undefined && (typeof config.limit !== 'number' || config.limit <= 0)) {
      throw new Error('`limit` must be a positive number.');
    }
    this._config = {
      limit: DEFAULT_LIMIT,
      show_timestamps: true,
      sort_order: 'desc',
      enable_send: false,
      ...config,
    };
  }

  // Masonry view sizing: roughly 50px per unit, so 6 ≈ 300px.
  public getCardSize() {
    return 6;
  }

  // Sections view sizing
  // (https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card#sizing-in-sections-view).
  public getGridOptions() {
    return { rows: 4, columns: 6, min_rows: 3, min_columns: 6 };
  }

  static get styles(): CSSResultGroup {
    return [sharedStyles, chatStyles];
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._maybeStart();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._teardown();
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('hass') || changed.has('_config')) {
      this._maybeStart();
    }
  }

  private _maybeStart(): void {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!this.isConnected || !this.hass || !this._config) return;
    const target = this._config.channel_entity;
    if (!target) return;
    if (this._subscribedEntity === target) return;
    void this._restart(target);
  }

  private async _restart(entityId: string): Promise<void> {
    this._teardown();
    this._subscribedEntity = entityId;
    this._error = undefined;
    this._messages = [];
    this._loading = true;
    this._sortOverride = undefined;
    try {
      const [history, unsub] = await Promise.all([
        loadHistory(this.hass, entityId),
        subscribeMessageLog(this.hass, entityId, (msg) => {
          this._appendMessage(msg);
        }),
      ]);
      // Guard against teardown/restart while we awaited.
      if (this._subscribedEntity !== entityId) {
        unsub();
        return;
      }
      this._unsubscribe = unsub;
      this._messages = trimMessages(history, this._config?.limit ?? DEFAULT_LIMIT);
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      if (this._subscribedEntity === entityId) this._loading = false;
    }
  }

  private _teardown(): void {
    if (this._unsubscribe) {
      try {
        this._unsubscribe();
      } catch {
        // ignore
      }
      this._unsubscribe = undefined;
    }
    this._subscribedEntity = undefined;
  }

  private _appendMessage(msg: ChatMessage): void {
    const limit = this._config?.limit ?? DEFAULT_LIMIT;
    const result = appendUnique(this._messages, msg, limit);
    if (!result.appended) return;
    this._flashIds.add(msg.id);
    this._messages = result.messages;
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has('_messages')) {
      if (this._autoStick) this._scrollToNewest();
      // Deterministically clear flash ids after the animation completes,
      // rather than racing the render with a microtask. The 1300ms is a
      // little longer than the 1.2s `flash` keyframe in styles.ts.
      if (this._flashIds.size > 0) {
        const ids = [...this._flashIds];
        setTimeout(() => {
          let cleared = false;
          for (const id of ids) {
            if (this._flashIds.delete(id)) cleared = true;
          }
          if (cleared) this.requestUpdate();
        }, 1300);
      }
    }
  }

  private _onScroll = (ev: Event): void => {
    const el = ev.currentTarget as HTMLElement;
    const distance = this._sortOrder() === 'desc' ? el.scrollTop : el.scrollHeight - el.scrollTop - el.clientHeight;
    this._autoStick = distance < 24;
  };

  private _scrollToNewest(): void {
    const el = this._scrollEl ?? this.renderRoot.querySelector<HTMLElement>('.messages');
    this._scrollEl = el;
    if (!el) return;
    const desc = this._sortOrder() === 'desc';
    // Defer to after the DOM has actually rendered the new row.
    requestAnimationFrame(() => {
      el.scrollTop = desc ? 0 : el.scrollHeight;
    });
  }

  private _sortOrder(): 'asc' | 'desc' {
    return this._sortOverride ?? this._config?.sort_order ?? 'desc';
  }

  private _toggleSortOrder = (): void => {
    this._sortOverride = this._sortOrder() === 'asc' ? 'desc' : 'asc';
    this._autoStick = true;
    this._scrollToNewest();
  };

  private _formatTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private _onDraftInput = (ev: Event): void => {
    const target = ev.currentTarget as HTMLInputElement;
    this._draft = target.value;
    if (this._sendError) this._sendError = undefined;
  };

  private _onComposerKeydown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      void this._onSend();
    }
  };

  private async _onSend(): Promise<void> {
    if (this._sending) return;
    const text = this._draft.trim();
    if (!text) return;
    const channel = this._config?.channel_entity;
    if (!channel) return;
    this._sending = true;
    this._sendError = undefined;
    try {
      await this.hass.callService('meshtastic', 'broadcast_channel_message', {
        channel,
        message: text,
        ack: true,
      });
      // No local echo: the integration fires `meshtastic_message_log` for
      // outbound messages, so the live subscription renders the sent row.
      this._draft = '';
    } catch (err) {
      this._sendError = err instanceof Error ? err.message : String(err);
    } finally {
      this._sending = false;
    }
  }

  private _renderComposer(): TemplateResult {
    const channel = this._config?.channel_entity;
    const channelMissing = !channel || !this.hass.states[channel];
    const disabled = this._sending || channelMissing || this._draft.trim().length === 0;
    return html`
      <div class="composer">
        <input
          class="composer-input"
          type="text"
          placeholder=${channelMissing ? 'Channel unavailable' : 'Send a message…'}
          .value=${this._draft}
          ?disabled=${this._sending || channelMissing}
          @input=${this._onDraftInput}
          @keydown=${this._onComposerKeydown}
        />
        <button class="composer-send" type="button" ?disabled=${disabled} @click=${() => void this._onSend()}>
          ${this._sending ? 'Sending…' : 'Send'}
        </button>
        ${this._sendError ? html`<span class="send-error" title=${this._sendError}>Send failed</span>` : nothing}
      </div>
    `;
  }

  private _renderRow(msg: ChatMessage): TemplateResult {
    const showTime = this._config?.show_timestamps !== false;
    const flash = this._flashIds.has(msg.id);
    return html`
      <div class="row ${flash ? 'live-flash' : ''}" title=${new Date(msg.time).toLocaleString()}>
        <span class="time">${showTime ? this._formatTime(msg.time) : nothing}</span>
        <span class="body">
          <span class="from">${msg.fromName}</span>
          <span class="text">${msg.message}</span>
          ${msg.pki ? html`<span class="pki" title="PKI / direct">🔒</span>` : nothing}
        </span>
      </div>
    `;
  }

  protected render(): TemplateResult {
    if (!this._config) {
      return html`<ha-card><div class="error">Card not configured.</div></ha-card>`;
    }
    const stateObj = this.hass.states[this._config.channel_entity] as HassEntity | undefined;
    const channelLabel = this._config.title ?? stateObj?.attributes.friendly_name ?? this._config.channel_entity;

    return html`
      <ha-card>
        <div class="header">
          <div class="title">${channelLabel}</div>
          <div class="meta">
            ${
              this._loading
                ? 'Loading…'
                : `${String(this._messages.length)} message${this._messages.length === 1 ? '' : 's'}`
            }
            <button
              class="sort-toggle"
              type="button"
              title=${this._sortOrder() === 'desc' ? 'Newest first (click to flip)' : 'Oldest first (click to flip)'}
              aria-label=${this._sortOrder() === 'desc' ? 'Sort oldest first' : 'Sort newest first'}
              @click=${this._toggleSortOrder}
            >
              ${this._sortOrder() === 'desc' ? '↓' : '↑'}
            </button>
          </div>
        </div>
        ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
        ${
          !stateObj && !this._error
            ? html`<div class="error">Channel entity not found: ${this._config.channel_entity}</div>`
            : nothing
        }
        ${this._config.enable_send ? this._renderComposer() : nothing}
        <div class="messages" @scroll=${this._onScroll}>
          ${
            this._messages.length === 0 && !this._loading && !this._error
              ? html`<div class="empty">No messages yet.</div>`
              : nothing
          }
          ${repeat(
            this._sortOrder() === 'desc' ? this._messages.toReversed() : this._messages,
            (m) => m.id,
            (m) => this._renderRow(m),
          )}
        </div>
      </ha-card>
    `;
  }
}
