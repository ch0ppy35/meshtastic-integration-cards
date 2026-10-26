import { css } from 'lit';

// Radio card layout on top of `sharedStyles`: a scrolling body like the chat
// card's message list, small section labels and label/value rows.
export const radioStyles = css`
  .sections {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 2px 12px 12px;
    display: flex;
    flex-direction: column;
  }
  .section-title {
    padding: 10px 4px 2px;
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--secondary-text-color);
  }
  .row {
    grid-template-columns: minmax(7.5em, max-content) 1fr;
  }
  .label {
    color: var(--secondary-text-color);
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .value {
    min-width: 0;
    color: var(--primary-text-color);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .traffic {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2px 8px;
  }
  .traffic .cell {
    display: flex;
    flex-direction: column;
    padding: 2px 4px;
    border-radius: 6px;
    line-height: 1.35;
  }
  .traffic .cell:hover {
    background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
  }
  .traffic .label {
    font-size: 0.78rem;
  }
  .traffic .value {
    font-size: 0.92rem;
    font-weight: 600;
  }
`;
