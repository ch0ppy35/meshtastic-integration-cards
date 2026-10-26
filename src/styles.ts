import { css } from 'lit';

// Styles shared by every card in the bundle so they read as one family:
// header bar, divider, row typography, hover tint and the live-flash.
// https://lit.dev/docs/components/styles/
export const sharedStyles = css`
  ha-card {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
  }
  .header .title {
    font-size: 1.05rem;
    font-weight: 500;
    color: var(--primary-text-color);
  }
  .header .meta {
    font-size: 0.8rem;
    color: var(--secondary-text-color);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .empty,
  .error {
    color: var(--secondary-text-color);
    padding: 12px 16px;
    font-style: italic;
  }
  .error {
    color: var(--error-color, #db4437);
    font-style: normal;
  }
  .row {
    display: grid;
    column-gap: 8px;
    align-items: baseline;
    padding: 2px 4px;
    border-radius: 6px;
    line-height: 1.35;
    font-size: 0.92rem;
  }
  .row:hover {
    background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
  }
  .live-flash {
    animation: flash 1.2s ease-out 1;
  }
  @keyframes flash {
    from {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
    }
    to {
      background: transparent;
    }
  }
`;

export const chatStyles = css`
  .header .sort-toggle {
    background: transparent;
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    color: var(--secondary-text-color);
    border-radius: 4px;
    padding: 0 6px;
    font-size: 0.95rem;
    line-height: 1.4;
    cursor: pointer;
    font-family: inherit;
  }
  .header .sort-toggle:hover {
    background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
    color: var(--primary-text-color);
  }
  .messages {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 6px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .composer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
  }
  .composer-input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    border-radius: 4px;
    background: var(--card-background-color, transparent);
    color: var(--primary-text-color);
    font: inherit;
    font-size: 0.92rem;
    line-height: 1.35;
  }
  .composer-input:focus {
    outline: none;
    border-color: var(--primary-color, #03a9f4);
  }
  .composer-input:disabled {
    opacity: 0.6;
  }
  .composer-send {
    background: var(--primary-color, #03a9f4);
    color: var(--text-primary-color, #fff);
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .composer-send:disabled {
    background: var(--secondary-background-color, rgba(0, 0, 0, 0.12));
    color: var(--secondary-text-color);
    cursor: not-allowed;
  }
  .composer .send-error {
    color: var(--error-color, #db4437);
    font-size: 0.8rem;
  }
  .row {
    grid-template-columns: auto 1fr;
  }
  .row .time {
    font-variant-numeric: tabular-nums;
    color: var(--secondary-text-color);
    font-size: 0.78rem;
    white-space: nowrap;
  }
  .row .body {
    min-width: 0;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .row .from {
    font-weight: 600;
    color: var(--primary-text-color);
    margin-right: 4px;
  }
  .row .from::after {
    content: ':';
    margin-left: 1px;
    color: var(--secondary-text-color);
    font-weight: 400;
  }
  .row .text {
    color: var(--primary-text-color);
  }
  .row .pki {
    margin-left: 4px;
    font-size: 0.85em;
  }
`;
