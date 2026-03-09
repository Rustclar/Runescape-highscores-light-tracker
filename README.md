# RuneScape Hiscores Lite Tracker (Stream Deck)

Stream Deck plugin for RuneScape/Old School RuneScape hiscores, RS3 Group Ironman rank tracking, and related overlays.

## Features

- `Level Tracker`
- RS3/OSRS total level display, optional rank and XP, configurable refresh/text style.
- `Player Skill`
- RS3/OSRS per-skill tracker (skill level + XP) with the same refresh/style controls.
- `My Group Rank`
- RS3/OSRS GIM group rank with optional rank/total level/XP display.
- `My Group Rank (Above)` and `My Group Rank (Below)`
- Linked neighbor group actions derived from your main group settings.
- `Other GIM Rank`
- Independent GIM tracking for another group.
- `Wilderness Event Timer`
- Next/specific flash event countdown.
- `Rune Goldberg (Vis Wax)`
- Daily rune combination display.

## End-User Install

- Download the latest `.streamDeckPlugin` from GitHub Releases.
- Double-click the file to install in Stream Deck.
- Open Stream Deck and add actions from the `RuneScape Hiscores Lite Tracker` category.

## Developer Prerequisites

- Node.js 20+
- Stream Deck app 7.2+
- Stream Deck CLI (`streamdeck`)

## Dev Commands

```bash
npm run build
npm run validate
npm run dev
npm run pack
```

- `npm run dev`: build -> validate -> link -> restart.
- `npm run pack`: build -> validate -> package to `dist/`.

## Packaging Output

- `dist/com.rustin.rs3.leveltracker2.0.streamDeckPlugin`

## Troubleshooting

- `npm run validate` for manifest/schema validation.
- `npm run restart` after code/UI changes.
- If plugin is installed (not linked), copy updated `.sdPlugin` folder into `%APPDATA%\Elgato\StreamDeck\Plugins\com.rustin.rs3.leveltracker2.0.sdPlugin` and restart.
- File logging is disabled by default for lower memory pressure.
- Optional file logging can be enabled with env var: `RS3_SD_FILE_LOGS=1`.

## Support

If you like it, buy me a coffee:  
https://buymeacoffee.com/rustclar
