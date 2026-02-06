import {
	action,
	DidReceiveSettingsEvent,
	KeyAction,
	SendToPluginEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

type EventMode = "next" | "specific";

type ActionSettings = {
	eventMode: EventMode;
	eventName: string;
	refreshSeconds: number;
	refreshPreset?: string;
	titleBold: boolean;
	titleColor: string;
	titleSize: number;
};

const DEFAULT_SETTINGS: ActionSettings = {
	eventMode: "next",
	eventName: "Infernal Star",
	refreshSeconds: 60,
	refreshPreset: "1",
	titleBold: true,
	titleColor: "#FFFFFF",
	titleSize: 24
};

const EVENT_ROTATION = [
	"Infernal Star",
	"Lost Souls",
	"Ramokee Incursion",
	"Displaced Energy",
	"Evil Bloodwood Tree",
	"Spider Swarm",
	"Unnatural Outcrop",
	"Stryke the Wyrm",
	"Demon Stragglers",
	"Butterfly Swarm",
	"King Black Dragon Rampage",
	"Forgotten Soldiers",
	"Surprising Seedlings",
	"Hellhound Pack"
];

type ContextState = {
	settings: ActionSettings;
	timerId?: NodeJS.Timeout;
	action: KeyAction<ActionSettings>;
	marqueeTimer?: NodeJS.Timeout;
	marqueeIndex: number;
	marqueeText?: string;
	marqueeLines?: string[];
};

@action({ UUID: "com.rustin.rs3.leveltracker2.0.wildy.event" })
export class Rs3WildyEventTimer extends SingletonAction<ActionSettings> {
	private readonly contexts = new Map<string, ContextState>();

	override onWillAppear(ev: WillAppearEvent<ActionSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		const settings = this.normalizeSettings(ev.payload.settings);
		this.setContext(ev.action, settings);
		this.startTimer(ev.action.id);
		this.refresh(ev.action.id).catch((error) => {
			streamDeck.logger.error(`Wildy timer refresh failed: ${String(error)}`);
		});
	}

	override onWillDisappear(ev: WillDisappearEvent<ActionSettings>): void {
		this.stopTimer(ev.action.id);
		this.contexts.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ActionSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		const settings = this.normalizeSettings(ev.payload.settings);
		this.setContext(ev.action, settings);
		this.startTimer(ev.action.id);
	}

	override async onSendToPlugin(
		ev: SendToPluginEvent<{ event: string; settings?: ActionSettings }, ActionSettings>
	): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		if (ev.payload.event === "saveSettings" && ev.payload.settings) {
			const settings = this.normalizeSettings(ev.payload.settings);
			this.setContext(ev.action, settings);
			await ev.action.setSettings(settings);
			this.startTimer(ev.action.id);
			await this.refresh(ev.action.id);
			return;
		}
		if (ev.payload.event === "refresh") {
			await this.refresh(ev.action.id);
		}
	}

	private normalizeSettings(settings?: Partial<ActionSettings>): ActionSettings {
		const merged: ActionSettings = {
			...DEFAULT_SETTINGS,
			...(settings ?? {})
		};
		const eventMode: EventMode = merged.eventMode === "specific" ? "specific" : "next";
		const eventName =
			typeof merged.eventName === "string" && merged.eventName.trim()
				? merged.eventName
				: DEFAULT_SETTINGS.eventName;
		const refreshSeconds = Number.isFinite(merged.refreshSeconds)
			? Math.max(30, Math.floor(merged.refreshSeconds))
			: DEFAULT_SETTINGS.refreshSeconds;
		const titleBold = Boolean(merged.titleBold);
		const titleColor = typeof merged.titleColor === "string" ? merged.titleColor : "#FFFFFF";
		const titleSize = Number.isFinite(merged.titleSize) ? merged.titleSize : 24;
		const refreshPreset =
			typeof merged.refreshPreset === "string" ? merged.refreshPreset : "1";
		return {
			eventMode,
			eventName,
			refreshSeconds,
			refreshPreset,
			titleBold,
			titleColor,
			titleSize
		};
	}

	private setContext(action: KeyAction<ActionSettings>, settings: ActionSettings): void {
		const existing = this.contexts.get(action.id);
		if (existing) {
			existing.settings = settings;
			existing.action = action;
		} else {
			this.contexts.set(action.id, { settings, action, marqueeIndex: 0 });
		}
	}

	private startTimer(contextId: string): void {
		this.stopTimer(contextId);
		const state = this.contexts.get(contextId);
		if (!state) return;
		state.timerId = setInterval(() => {
			this.refresh(contextId).catch((error) => {
				streamDeck.logger.error(`Wildy timer refresh failed: ${String(error)}`);
			});
		}, state.settings.refreshSeconds * 1000);
	}

	private stopTimer(contextId: string): void {
		const state = this.contexts.get(contextId);
		if (state?.timerId) {
			clearInterval(state.timerId);
			state.timerId = undefined;
		}
	}

	private stopMarquee(contextId: string): void {
		const state = this.contexts.get(contextId);
		if (state?.marqueeTimer) {
			clearInterval(state.marqueeTimer);
			state.marqueeTimer = undefined;
			state.marqueeText = undefined;
			state.marqueeLines = undefined;
			state.marqueeIndex = 0;
		}
	}

	private async refresh(contextId: string): Promise<void> {
		const state = this.contexts.get(contextId);
		if (!state) return;
		const { nextEvent, nextTime } = this.getNextEvent(state.settings);
		const timeLabel = this.formatLocalTime(nextTime);
		const minutesLeft = Math.max(0, Math.round((nextTime - Date.now()) / 60000));
		const timeRemaining =
			minutesLeft >= 60
				? `IN ${Math.floor(minutesLeft / 60)}H ${minutesLeft % 60}M`
				: `IN ${minutesLeft}M`;
		const lines = [
			nextEvent,
			this.truncateLine(timeLabel, this.getMaxChars(state.settings.titleSize)),
			this.truncateLine(timeRemaining, this.getMaxChars(state.settings.titleSize))
		];
		await this.renderKey(contextId, lines);
	}

	private getNextEvent(settings: ActionSettings): { nextEvent: string; nextTime: number } {
		const now = new Date();
		const utcNow = Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate(),
			now.getUTCHours(),
			now.getUTCMinutes(),
			now.getUTCSeconds()
		);
		const nextHour = utcNow - (utcNow % 3600000) + 3600000;
		const baseIndex = this.getRotationIndex(nextHour);
		if (settings.eventMode === "specific") {
			const targetIndex = EVENT_ROTATION.findIndex(
				(eventName) => eventName.toLowerCase() === settings.eventName.toLowerCase()
			);
			if (targetIndex >= 0) {
				const offset =
					(targetIndex - baseIndex + EVENT_ROTATION.length) % EVENT_ROTATION.length;
				return {
					nextEvent: EVENT_ROTATION[targetIndex],
					nextTime: nextHour + offset * 3600000
				};
			}
		}
		return { nextEvent: EVENT_ROTATION[baseIndex], nextTime: nextHour };
	}

	private getRotationIndex(timestampUtcMs: number): number {
		const date = new Date(timestampUtcMs);
		const base = Date.UTC(
			date.getUTCFullYear(),
			date.getUTCMonth(),
			date.getUTCDate(),
			0,
			0,
			0
		);
		const hoursSinceBase = Math.floor((timestampUtcMs - base) / 3600000);
		return ((hoursSinceBase % EVENT_ROTATION.length) + EVENT_ROTATION.length) % EVENT_ROTATION.length;
	}

	private formatLocalTime(timestamp: number): string {
		return new Date(timestamp).toLocaleTimeString([], {
			hour: "numeric",
			minute: "2-digit"
		});
	}

	private async renderKey(contextId: string, lines: string[]): Promise<void> {
		const state = this.contexts.get(contextId);
		if (!state) return;
		const maxChars = this.getMaxChars(state.settings.titleSize);
		const wrapped = this.wrapFirstLine(lines, maxChars);
		if (wrapped) {
			this.stopMarquee(contextId);
			await state.action.setTitle(wrapped.join("\n"), { target: 0 });
			return;
		}
		if (lines[0] && lines[0].length > maxChars) {
			this.startMarquee(contextId, lines, maxChars);
			return;
		}
		this.stopMarquee(contextId);
		await state.action.setTitle(lines.join("\n"), { target: 0 });
	}

	private startMarquee(contextId: string, lines: string[], maxChars: number): void {
		const state = this.contexts.get(contextId);
		if (!state) return;
		const full = lines[0];
		const padded = `${full}   `;
		if (state.marqueeText === padded) {
			return;
		}
		this.stopMarquee(contextId);
		state.marqueeText = padded;
		state.marqueeLines = lines.slice(1);
		state.marqueeIndex = 0;
		const loop = padded + padded;
		state.marqueeTimer = setInterval(() => {
			const offset = state.marqueeIndex % padded.length;
			const head = loop.slice(offset, offset + maxChars);
			state.marqueeIndex += 1;
			const rendered = [head, ...(state.marqueeLines ?? [])];
			state.action.setTitle(rendered.join("\n"), { target: 0 }).catch((error) => {
				streamDeck.logger.error(`Wildy marquee render failed: ${String(error)}`);
			});
		}, 500);
	}

	private truncateLine(value: string, max = 14): string {
		if (value.length <= max) {
			return value;
		}
		return `${value.slice(0, Math.max(0, max - 1))}…`;
	}

	private wrapFirstLine(lines: string[], max = 14): string[] | null {
		const [first, ...rest] = lines;
		if (!first || first.length <= max) {
			return lines;
		}
		if (rest.length >= 2) {
			return null;
		}
		const trimmed = first.trim();
		if (!trimmed.includes(" ")) {
			return null;
		}
		const candidate = trimmed.slice(0, max + 1);
		const splitAt = candidate.lastIndexOf(" ");
		if (splitAt <= 0) {
			return null;
		}
		const line1 = trimmed.slice(0, splitAt).trim();
		const line2 = trimmed.slice(splitAt + 1).trim();
		if (!line1 || !line2) {
			return null;
		}
		if (line1.length > max || line2.length > max) {
			return null;
		}
		return [line1, line2, ...rest];
	}

	private getMaxChars(titleSize: number): number {
		if (titleSize >= 28) return 9;
		if (titleSize >= 26) return 10;
		if (titleSize >= 24) return 11;
		if (titleSize >= 22) return 12;
		return 14;
	}
}
