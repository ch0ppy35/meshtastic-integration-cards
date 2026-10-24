# Changelog

## Unreleased

🚀 New features:

- Optional `enable_send` config flag adds a composer at the top of the card.
  When enabled, sends to the configured channel via the integration's
  `meshtastic.broadcast_channel_message` service.

🐛 Bug fixes:

- Sent messages no longer appear twice or as `Unknown: «msg» to <channel>`
  after a reload. The card now relies on the integration's outbound
  `meshtastic_message_log` event and logbook entries, shows them as **You**,
  and no longer adds a local in-memory echo.

💥 Breaking changes:

- Removed the `show_pki_badge` config option. The 🔒 badge is now always
  shown for messages with `pki: true`.

## v1.0.0 (unreleased)

🚀 New features:

- Initial release. Read-only Lovelace card that displays Meshtastic channel
  messages recorded by the `meshtastic` Home Assistant integration.
- Per-card channel selection via HA entity selector
  (`device_class: "channel"`).
- Backfills history from `logbook/get_events` and live-updates via the
  `meshtastic_message_log` event bus.
- Visual editor (`title`, `channel_entity`, `limit`, `show_timestamps`,
  `sort_order`).
