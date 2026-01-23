# RuneScape Hiscores Lite Tracker (Stream Deck)

Shows RuneScape total level and optional XP using the hiscores lite endpoint.

## Prerequisites

- Node.js 20+
- Stream Deck app 7.2+
- Stream Deck CLI (`streamdeck`)

## Development

```bash
npm run dev
```

This builds the plugin, validates the manifest, links it, and restarts it in Stream Deck.

## Packaging

```bash
npm run pack
```

Creates a `.streamDeckPlugin` file in `dist`.

## Usage

1. Add the **RS3 Level Tracker** action to a key.
2. Set `Player name`.
3. Choose the mode from the dropdown (RS3 or OSRS variants).
4. Adjust refresh interval, show XP, text color, and text size as needed.
5. Click **Save** and optionally **Test Pull**.

## Troubleshooting

- Run `npm run validate` to check manifest issues.
- Run `npm run restart` if the plugin doesn’t update.
- Ensure Developer Mode is enabled: `streamdeck dev`.
