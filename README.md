# RuneScape Hiscores Lite Tracker (Stream Deck)

Shows RuneScape total level and optional XP using the hiscores lite endpoint.

## Features

- RS3/OSRS single-player hiscores: total level + optional XP + optional rank
- RS3 Group Ironman group rank (regular/competitive, team sizes 2–5)
- RS3 GIM neighbor actions (above/below the selected group)
- GIM key press opens the group page in your browser
- Sword background with configurable text color + size
- Single Refresh button (saves + refreshes)
- Optional My GIM players dropdown on Level Tracker
- Caching for group rank lookups (10 minutes)
- Long names wrap or auto-scroll on the key display

## Requirements (end users)

- Stream Deck app 7.2+

## Install (end users)

1. Download the latest `.streamDeckPlugin` from the `dist/` folder or GitHub Releases.
2. Double-click the `.streamDeckPlugin` file to install it.
3. Open Stream Deck and find **RuneScape Hiscores Lite Tracker** in the Actions list.

## Development

## Requirements (developers)

- Node.js 20+
- Stream Deck app 7.2+
- Stream Deck CLI (`streamdeck`)

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
5. Click **Refresh** to save and update the key.

## Troubleshooting

- Run `npm run validate` to check manifest issues.
- Run `npm run restart` if the plugin doesn’t update.
- Ensure Developer Mode is enabled: `streamdeck dev`.

## Support

If you like it, buy me a coffee:
https://buymeacoffee.com/rustclar
