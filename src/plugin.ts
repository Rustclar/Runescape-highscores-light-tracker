import streamDeck, { LogLevel } from "@elgato/streamdeck";

import {
	Rs3GimGroupRank,
	Rs3GimGroupRankAboveLinked,
	Rs3GimGroupRankBelowLinked,
	Rs3GimGroupRankOther
} from "./actions/rs3-gim-group-rank";
import { Rs3LevelTracker } from "./actions/rs3-level-tracker";
import { Rs3SkillTracker } from "./actions/rs3-skill-tracker";
import { Rs3WildyEventTimer } from "./actions/rs3-wildy-event-timer";
import { Rs3Goldberg } from "./actions/rs3-goldberg";
import { startUpdateScheduler } from "./update-scheduler";
import { checkForUpdate } from "./update-check";

streamDeck.logger.setLevel(LogLevel.INFO);
streamDeck.actions.registerAction(new Rs3GimGroupRankAboveLinked());
streamDeck.actions.registerAction(new Rs3GimGroupRankBelowLinked());
streamDeck.actions.registerAction(new Rs3GimGroupRank());
streamDeck.actions.registerAction(new Rs3GimGroupRankOther());
streamDeck.actions.registerAction(new Rs3LevelTracker());
streamDeck.actions.registerAction(new Rs3SkillTracker());
streamDeck.actions.registerAction(new Rs3WildyEventTimer());
streamDeck.actions.registerAction(new Rs3Goldberg());
startUpdateScheduler(checkForUpdate, (message, data) =>
	streamDeck.logger.info(`${message} ${JSON.stringify(data ?? {})}`)
);
streamDeck.connect();
