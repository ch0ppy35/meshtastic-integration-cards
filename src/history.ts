import { type HomeAssistant } from './ha-types';
import { DEFAULT_HISTORY_DAYS, OUTBOUND_SENDER, type ChatMessage, type LogbookEntry } from './types';

// Logbook describer in the meshtastic integration formats messages as:
//   «<message>» by <from_name>   (received)
//   «<message>» to <to_name>     (sent from Home Assistant)
// We split on the trailing " by " / " to " (last occurrence) so that messages
// containing those words survive the round-trip.
const BACKFILL_MESSAGE_RE = /^«([\s\S]*)»\s+by\s+([\s\S]+)$/;
const BACKFILL_OUTBOUND_RE = /^«([\s\S]*)»\s+to\s+[\s\S]+$/;

const parseLogbookMessage = (raw: string | undefined): { message: string; fromName: string } | null => {
  if (!raw) return null;
  const m = BACKFILL_MESSAGE_RE.exec(raw);
  if (m) return { message: m[1], fromName: m[2].trim() };
  const out = BACKFILL_OUTBOUND_RE.exec(raw);
  if (out) return { message: out[1], fromName: OUTBOUND_SENDER };
  return null;
};

const toIsoTime = (when: number | string | undefined): string => {
  if (typeof when === 'number') {
    // HA returns seconds since epoch as a float for logbook entries.
    return new Date(when * 1000).toISOString();
  }
  if (typeof when === 'string') {
    const d = new Date(when);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
};

// Load history for a given channel entity from the recorder via the logbook
// websocket API. Messages are returned oldest-first.
export const loadHistory = async (
  hass: HomeAssistant,
  entityId: string,
  options: { days?: number } = {},
): Promise<ChatMessage[]> => {
  const days = options.days ?? DEFAULT_HISTORY_DAYS;
  const startTime = new Date(Date.now() - days * 86_400_000).toISOString();

  let entries: LogbookEntry[];
  try {
    entries = await hass.callWS<LogbookEntry[]>({
      type: 'logbook/get_events',
      start_time: startTime,
      entity_ids: [entityId],
    });
  } catch (err) {
    // Surface the error to callers but don't break the whole card.
    // eslint-disable-next-line no-console
    console.warn('[meshtastic-chat-card] logbook/get_events failed', err);
    return [];
  }

  const messages: ChatMessage[] = [];
  for (const entry of entries) {
    if (entry.domain && entry.domain !== 'meshtastic') continue;
    if (entry.entity_id && entry.entity_id !== entityId) continue;

    // Prefer the meshtastic logbook describer's `«…» by …` format.
    // If the upstream describer ever changes, fall back to using the raw
    // `message`/`name` so the card still degrades gracefully instead of
    // showing nothing.
    const parsed =
      parseLogbookMessage(entry.message) ??
      (entry.message ? { message: entry.message, fromName: entry.name?.trim() ?? 'Unknown' } : null);
    if (!parsed) continue;

    const time = toIsoTime(entry.when);
    const pki = entry.icon === 'mdi:message-lock';
    const id = entry.context_id ?? `hist-${time}-${String(messages.length)}`;

    messages.push({
      id,
      time,
      fromName: parsed.fromName,
      message: parsed.message,
      pki,
      source: 'history',
    });
  }
  return messages;
};
