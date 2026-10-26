// Shared card registration helpers. Every card in the bundle registers
// through here so the dev suffix and picker metadata stay consistent.

// `__MESHTASTIC_CARD_DEV__` is replaced at build time by @rollup/plugin-replace
// (true for the dev rollup config, false for the production build). Declaring
// it lets us reference the constant without depending on a runtime env var.
declare const __MESHTASTIC_CARD_DEV__: boolean;
export const DEV: boolean = typeof __MESHTASTIC_CARD_DEV__ !== 'undefined' ? __MESHTASTIC_CARD_DEV__ : false;

export const REPO_URL = 'https://github.com/ch0ppy35/meshtastic-integration-cards';

export interface CustomCardEntry {
  type: string;
  name: string;
  preview?: boolean;
  description?: string;
  documentationURL?: string;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}

export interface CardRegistration {
  id: string;
  name: string;
  description: string;
}

// Add a card to the Lovelace card picker and return the custom element tag
// it must be defined under (`<id>-dev` in dev builds).
export const registerCard = ({ id, name, description }: CardRegistration): string => {
  const tag = `${id}${DEV ? '-dev' : ''}`;
  window.customCards = window.customCards ?? [];
  window.customCards.push({
    type: tag,
    name: `${name}${DEV ? ' DEV' : ''}`,
    preview: false,
    description,
    documentationURL: REPO_URL,
  });
  return tag;
};
