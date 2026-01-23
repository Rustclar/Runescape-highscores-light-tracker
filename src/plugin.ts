import streamDeck, { LogLevel } from "@elgato/streamdeck";

import { Rs3LevelTracker } from "./actions/rs3-level-tracker";

streamDeck.logger.setLevel(LogLevel.TRACE);
streamDeck.actions.registerAction(new Rs3LevelTracker());
streamDeck.connect();
