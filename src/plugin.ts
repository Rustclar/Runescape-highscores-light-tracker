import streamDeck, { LogLevel } from "@elgato/streamdeck";

import {
	Rs3GimGroupRank,
	Rs3GimGroupRankAboveLinked,
	Rs3GimGroupRankBelowLinked,
	Rs3GimGroupRankOther
} from "./actions/rs3-gim-group-rank";
import { Rs3LevelTracker } from "./actions/rs3-level-tracker";

streamDeck.logger.setLevel(LogLevel.TRACE);
streamDeck.actions.registerAction(new Rs3GimGroupRankAboveLinked());
streamDeck.actions.registerAction(new Rs3GimGroupRankBelowLinked());
streamDeck.actions.registerAction(new Rs3GimGroupRank());
streamDeck.actions.registerAction(new Rs3GimGroupRankOther());
streamDeck.actions.registerAction(new Rs3LevelTracker());
streamDeck.connect();
