import streamDeck, { LogLevel } from "@elgato/streamdeck";

import {
	Rs3GimGroupRank,
	Rs3GimGroupRankAbove,
	Rs3GimGroupRankBelow
} from "./actions/rs3-gim-group-rank";
import { Rs3LevelTracker } from "./actions/rs3-level-tracker";

streamDeck.logger.setLevel(LogLevel.TRACE);
streamDeck.actions.registerAction(new Rs3GimGroupRankAbove());
streamDeck.actions.registerAction(new Rs3GimGroupRankBelow());
streamDeck.actions.registerAction(new Rs3GimGroupRank());
streamDeck.actions.registerAction(new Rs3LevelTracker());
streamDeck.connect();
