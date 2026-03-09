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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ActionSettings = {
	refreshSeconds: number;
	refreshPreset?: string;
	titleBold: boolean;
	titleColor: string;
	titleSize: number;
};

type SlotTwoOption = {
	rune: string;
	percent: number;
};

const DEFAULT_SETTINGS: ActionSettings = {
	refreshSeconds: 600,
	refreshPreset: "10",
	titleBold: true,
	titleColor: "#FFFFFF",
	titleSize: 24
};

const GOLDBERG_URL = "https://www.warbandtracker.com/goldberg/index.php";
const ENABLE_FILE_LOGS = process.env.RS3_SD_FILE_LOGS === "1";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ContextState = {
	settings: ActionSettings;
	timerId?: NodeJS.Timeout;
	action: KeyAction<ActionSettings>;
	marqueeTimer?: NodeJS.Timeout;
	marqueeIndex: number;
	marqueeText?: string;
	marqueeLines?: string[];
	isFetching: boolean;
};

@action({ UUID: "com.rustin.rs3.leveltracker2.0.goldberg" })
export class Rs3Goldberg extends SingletonAction<ActionSettings> {
	private readonly contexts = new Map<string, ContextState>();
	private readonly logPath = this.resolveLogPath();

	override onWillAppear(ev: WillAppearEvent<ActionSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		const settings = this.normalizeSettings(ev.payload.settings);
		this.setContext(ev.action, settings);
		this.startTimer(ev.action.id);
		this.refresh(ev.action.id).catch((error) => {
			streamDeck.logger.error(`Goldberg refresh failed: ${String(error)}`);
		});
	}

	override onWillDisappear(ev: WillDisappearEvent<ActionSettings>): void {
		this.stopTimer(ev.action.id);
		this.stopMarquee(ev.action.id);
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
		const refreshSeconds = Number.isFinite(merged.refreshSeconds)
			? Math.max(60, Math.floor(merged.refreshSeconds))
			: DEFAULT_SETTINGS.refreshSeconds;
		const titleBold = Boolean(merged.titleBold);
		const titleColor = typeof merged.titleColor === "string" ? merged.titleColor : "#FFFFFF";
		const titleSize = Number.isFinite(merged.titleSize) ? merged.titleSize : 24;
		const refreshPreset =
			typeof merged.refreshPreset === "string" ? merged.refreshPreset : "10";
		return {
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
			this.contexts.set(action.id, {
				settings,
				action,
				marqueeIndex: 0,
				isFetching: false
			});
		}
	}

	private startTimer(contextId: string): void {
		this.stopTimer(contextId);
		const state = this.contexts.get(contextId);
		if (!state) return;
		state.timerId = setInterval(() => {
			this.refresh(contextId).catch((error) => {
				streamDeck.logger.error(`Goldberg refresh failed: ${String(error)}`);
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
		if (!state || state.isFetching) {
			return;
		}
		this.log("goldbergRefresh", { context: contextId });
		state.isFetching = true;
		try {
			const data = await this.fetchGoldberg();
			if (!data) {
				await state.action.setTitle("ERR\nCHECK\nWEB", { target: 0 });
				return;
			}
			const lines = this.buildLines(data, state.settings);
			await this.renderKey(contextId, lines);
		} catch (error) {
			streamDeck.logger.error(`Goldberg refresh failed: ${String(error)}`);
			await state.action.setTitle("ERR", { target: 0 });
		} finally {
			state.isFetching = false;
		}
	}

	private buildLines(
		data: { slot1: string; slot2: SlotTwoOption[] },
		settings: ActionSettings
	): string[] {
		const maxChars = this.getMaxChars(settings.titleSize);
		const normalize = (value: string) => {
			const cleaned = value.replace(/\bRune\b/gi, "").replace(/\s+/g, " ").trim();
			const parts = cleaned.split(" ").filter(Boolean);
			const deduped: string[] = [];
			for (const part of parts) {
				if (deduped[deduped.length - 1]?.toLowerCase() !== part.toLowerCase()) {
					deduped.push(part);
				}
			}
			return deduped.join(" ");
		};
		const slot1 = data.slot1 ? normalize(data.slot1) : "?";
		const slot2a = data.slot2[0]?.rune ? normalize(data.slot2[0].rune) : "?";
		const slot2b = data.slot2[1]?.rune ? normalize(data.slot2[1].rune) : "?";
		const slot2c = data.slot2[2]?.rune ? normalize(data.slot2[2].rune) : "?";
		return [slot1, slot2a, slot2b, slot2c].map((line) =>
			this.truncateLine(line, maxChars)
		);
	}

	private async fetchGoldberg(): Promise<{ slot1: string; slot2: SlotTwoOption[] } | null> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 7000);
		try {
			const response = await fetch(GOLDBERG_URL, {
				signal: controller.signal,
				headers: {
					"User-Agent": "rs3-level-tracker",
					"Accept": "text/html"
				}
			});
			this.log("goldbergFetchStatus", { status: response.status });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const html = await response.text();
			this.log("goldbergHtmlLength", { length: html.length });
			return this.parseGoldberg(html);
		} catch (error) {
			this.log("goldbergFetchFailed", { error: String(error) });
			return null;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private parseGoldberg(html: string): { slot1: string; slot2: SlotTwoOption[] } | null {
		const text = this.htmlToText(html);
		const section =
			this.sliceBetween(text, "Correct Rune Combinations", "Submit report") ?? text;
		const firstChunk =
			this.sliceBetween(section, "First Rune", "Second Rune") ?? section;
		const slot1Match =
			firstChunk.match(/today it is the\s+([A-Za-z ]+?)\s*rune/i) ??
			firstChunk.match(/([A-Za-z ]+?)\s*Rune/i);
		const slot1 = slot1Match ? `${slot1Match[1].trim()} Rune` : "";
		const slot2: SlotTwoOption[] = [];

		const secondChunk = section.split(/Second Rune/i)[1] ?? section;
		this.collectSlotTwo(secondChunk, slot2);
		if (!slot2.length) {
			this.collectSlotTwoFromHtml(html, slot2);
		}
		if (!slot2.length) {
			this.collectSlotTwo(text, slot2);
		}
		slot2.sort((a, b) => b.percent - a.percent);
		if (!slot1 || !slot2.length) {
			this.logParseDebug(html, slot1, slot2.length);
			return null;
		}
		return { slot1, slot2 };
	}

	private collectSlotTwo(source: string, slot2: SlotTwoOption[]): void {
		const regex = /([A-Za-z ]+?)\s*Rune\s*Reported by\s*([0-9.]+)%/gi;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(source))) {
			const rune = `${match[1].trim()} Rune`;
			const percent = Number.parseFloat(match[2]);
			if (!Number.isFinite(percent)) continue;
			if (!slot2.find((entry) => entry.rune === rune)) {
				slot2.push({ rune, percent });
			}
		}
	}

	private collectSlotTwoFromHtml(html: string, slot2: SlotTwoOption[]): void {
		const secondSection =
			this.sliceBetween(html, "Second Rune", "Third Rune") ??
			this.sliceBetween(html, "Second Rune", "Submit report") ??
			html;
		const imgRegex =
			/(?:alt|title)=["']([^"']+?\bRune)\b[^"']*["'][\s\S]{0,300}?([0-9.]+)%/gi;
		let match: RegExpExecArray | null;
		while ((match = imgRegex.exec(secondSection))) {
			const rune = match[1].trim();
			const percent = Number.parseFloat(match[2]);
			if (!Number.isFinite(percent)) continue;
			if (!slot2.find((entry) => entry.rune === rune)) {
				slot2.push({ rune, percent });
			}
		}
		if (!slot2.length) {
			const nearRegex = /([A-Za-z ]+?)\s*Rune[\s\S]{0,120}?([0-9.]+)%/gi;
			while ((match = nearRegex.exec(secondSection))) {
				const rune = `${match[1].trim()} Rune`;
				const percent = Number.parseFloat(match[2]);
				if (!Number.isFinite(percent)) continue;
				if (!slot2.find((entry) => entry.rune === rune)) {
					slot2.push({ rune, percent });
				}
			}
		}
	}

	private sliceBetween(source: string, start: string, end: string): string | null {
		const lower = source.toLowerCase();
		const startIdx = lower.indexOf(start.toLowerCase());
		if (startIdx < 0) return null;
		const endIdx = lower.indexOf(end.toLowerCase(), startIdx + start.length);
		if (endIdx < 0) return source.slice(startIdx + start.length);
		return source.slice(startIdx + start.length, endIdx);
	}

	private htmlToText(html: string): string {
		const withAlts = html
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<img[^>]*alt="([^"]+)"[^>]*>/gi, " $1 ")
			.replace(/<img[^>]*alt='([^']+)'[^>]*>/gi, " $1 ")
			.replace(/<img[^>]*title="([^"]+)"[^>]*>/gi, " $1 ")
			.replace(/<img[^>]*title='([^']+)'[^>]*>/gi, " $1 ");
		return withAlts
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;|&#160;/gi, " ")
			.replace(/&amp;/gi, "&")
			.replace(/\s+/g, " ")
			.trim();
	}

	private logParseDebug(html: string, slot1: string, slot2Count: number): void {
		const firstIdx = html.search(/First Rune/i);
		const secondIdx = html.search(/Second Rune/i);
		const correctIdx = html.search(/Correct Rune Combinations/i);
		const sample = (idx: number) =>
			idx >= 0 ? html.slice(idx, idx + 400).replace(/\s+/g, " ") : "not found";
		const normalize = (value: string) => value.replace(/\s+/g, " ");
		const detail =
			this.sliceBetween(html, "Detailed Rune Data", "Submit report") ??
			this.sliceBetween(html, "Detailed Rune Data", "Correct Rune Combinations") ??
			"";
		this.log("goldbergParseFailed", {
			slot1,
			slot2Count,
			correctIdx,
			firstIdx,
			secondIdx,
			firstSample: sample(firstIdx),
			secondSample: sample(secondIdx),
			detailSample: detail ? normalize(detail.slice(0, 1200)) : "no detail section"
		});
	}

	private resolveLogPath(): string {
		const base = process.env.APPDATA;
		if (!base) {
			return "";
		}
		return path.join(
			base,
			"Elgato",
			"StreamDeck",
			"logs",
			"com.rustin.rs3.leveltracker2.0.log"
		);
	}

	private log(message: string, data?: Record<string, unknown>): void {
		const line = `[${new Date().toISOString()}] ${message}${
			data ? ` ${JSON.stringify(data)}` : ""
		}`;
		streamDeck.logger.info(line);
		if (!this.logPath) {
			return;
		}
		if (ENABLE_FILE_LOGS) {
			try {
				fs.appendFileSync(this.logPath, `${line}\n`, "utf8");
			} catch (error) {
				streamDeck.logger.warn(`log write failed: ${String(error)}`);
			}
		}
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
				streamDeck.logger.error(`Goldberg marquee render failed: ${String(error)}`);
			});
		}, 1000);
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
