import {
	action,
	DidReceiveSettingsEvent,
	KeyAction,
	KeyDownEvent,
	SendToPluginEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type HiscoreMode =
	| "hiscore"
	| "hiscore_ironman"
	| "hiscore_hardcore_ironman"
	| "hiscore_oldschool"
	| "hiscore_oldschool_ironman"
	| "hiscore_oldschool_hardcore_ironman"
	| "hiscore_oldschool_ultimate"
	| "hiscore_oldschool_deadman"
	| "hiscore_oldschool_seasonal";

type ActionSettings = {
	playerName: string;
	mode: HiscoreMode;
	refreshSeconds: number;
	refreshPreset?: string;
	titleBold: boolean;
	titleColor: string;
	titleSize: number;
};

type SeenSnapshot = {
	playerName: string;
	mode: HiscoreMode;
	baselineXp: number;
	baselineSeenAt: string;
	baselineDay: string;
	latestXp: number;
	latestSeenAt: string;
	latestDay: string;
	updatedAt: string;
};

type GlobalSettings = {
	xpSinceSeenSnapshots?: Record<string, SeenSnapshot>;
	[key: string]: unknown;
};

type ContextState = {
	settings: ActionSettings;
	timerId?: NodeJS.Timeout;
	isFetching: boolean;
	action: KeyAction<ActionSettings>;
	marqueeTimer?: NodeJS.Timeout;
	marqueeIndex: number;
	marqueeText?: string;
	marqueeLines?: string[];
};

const DEFAULT_SETTINGS: ActionSettings = {
	playerName: "",
	mode: "hiscore",
	refreshSeconds: 300,
	refreshPreset: "5",
	titleBold: true,
	titleColor: "#FFFFFF",
	titleSize: 24
};

const ALLOWED_MODES: HiscoreMode[] = [
	"hiscore",
	"hiscore_ironman",
	"hiscore_hardcore_ironman",
	"hiscore_oldschool",
	"hiscore_oldschool_ironman",
	"hiscore_oldschool_hardcore_ironman",
	"hiscore_oldschool_ultimate",
	"hiscore_oldschool_deadman",
	"hiscore_oldschool_seasonal"
];

const ALLOWED_COLORS = [
	{ label: "Black", value: "#000000" },
	{ label: "White", value: "#FFFFFF" },
	{ label: "Red", value: "#DC2626" },
	{ label: "Green", value: "#16A34A" },
	{ label: "Blue", value: "#2563EB" },
	{ label: "Yellow", value: "#F59E0B" },
	{ label: "Orange", value: "#F97316" },
	{ label: "Purple", value: "#7C3AED" },
	{ label: "Cyan", value: "#06B6D4" },
	{ label: "Magenta", value: "#DB2777" },
	{ label: "Gray", value: "#6B7280" }
];

const ALLOWED_SIZES = [16, 18, 20, 22, 24, 26, 28];
const MAX_SNAPSHOTS = 200;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

@action({ UUID: "com.rustin.rs3.leveltracker2.0.dailyxpgain" })
export class Rs3DailyXpGain extends SingletonAction<ActionSettings> {
	private readonly contexts = new Map<string, ContextState>();
	private readonly numberFormatter = new Intl.NumberFormat("en-US");
	private baseImageData?: string;

	override onWillAppear(ev: WillAppearEvent<ActionSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		const settings = this.normalizeSettings(ev.payload.settings);
		this.setContext(ev.action, settings);
		this.startTimer(ev.action.id);
		this.refresh(ev.action.id).catch((error) => {
			streamDeck.logger.error(`Daily XP refresh failed: ${String(error)}`);
		});
	}

	override onWillDisappear(ev: WillDisappearEvent<ActionSettings>): void {
		this.stopTimer(ev.action.id);
		this.stopMarquee(ev.action.id);
		this.contexts.delete(ev.action.id);
	}

	override onKeyDown(ev: KeyDownEvent<ActionSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		this.refresh(ev.action.id).catch((error) => {
			streamDeck.logger.error(`Daily XP refresh failed: ${String(error)}`);
		});
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
		if (ev.payload.settings) {
			const settings = this.normalizeSettings(ev.payload.settings);
			this.setContext(ev.action, settings);
			await ev.action.setSettings(settings);
			this.startTimer(ev.action.id);
		}
		if (ev.payload.event === "saveSettings") {
			await this.refresh(ev.action.id);
			return;
		}
		if (ev.payload.event === "markSeen" || ev.payload.event === "resetToday") {
			await this.markSeenNow(ev.action.id);
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
		const mode = ALLOWED_MODES.includes(merged.mode) ? merged.mode : DEFAULT_SETTINGS.mode;
		const refreshSeconds = Number.isFinite(merged.refreshSeconds)
			? Math.max(30, Math.floor(merged.refreshSeconds))
			: DEFAULT_SETTINGS.refreshSeconds;
		const normalizedColor =
			typeof merged.titleColor === "string" ? merged.titleColor.trim() : "";
		const allowedColors = new Set(ALLOWED_COLORS.map((entry) => entry.value));
		const titleColor = allowedColors.has(normalizedColor)
			? normalizedColor
			: DEFAULT_SETTINGS.titleColor;
		const titleBold = Boolean(merged.titleBold);
		const titleSize = ALLOWED_SIZES.includes(merged.titleSize)
			? merged.titleSize
			: DEFAULT_SETTINGS.titleSize;
		return {
			...merged,
			playerName: typeof merged.playerName === "string" ? merged.playerName : "",
			mode,
			refreshPreset:
				typeof merged.refreshPreset === "string"
					? merged.refreshPreset
					: DEFAULT_SETTINGS.refreshPreset,
			refreshSeconds,
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
			return;
		}
		this.contexts.set(action.id, {
			settings,
			isFetching: false,
			action,
			marqueeIndex: 0
		});
	}

	private startTimer(contextId: string): void {
		this.stopTimer(contextId);
		const state = this.contexts.get(contextId);
		if (!state) {
			return;
		}
		state.timerId = setInterval(() => {
			this.refresh(contextId).catch((error) => {
				streamDeck.logger.error(`Daily XP refresh failed: ${String(error)}`);
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
		const settings = state.settings;
		if (!settings.playerName.trim()) {
			await this.renderKey(contextId, ["SET RSN"], settings);
			return;
		}

		state.isFetching = true;
		await this.renderKey(contextId, ["..."], settings);
		try {
			const result = await this.fetchHiscore(settings);
			if (!result) {
				throw new Error("No hiscore data");
			}
			const { snapshot, firstSeen } = await this.updateSnapshot(settings, result.totalXp);
			const gained = Math.max(0, result.totalXp - snapshot.baselineXp);
			const elapsed = firstSeen
				? "JUST NOW"
				: `SINCE ${this.formatSeenTime(snapshot.baselineSeenAt)}`;
			await this.renderKey(
				contextId,
				[settings.playerName, `+${this.formatCompact(gained)} XP`, elapsed],
				settings
			);
		} catch (error) {
			streamDeck.logger.error(`Daily XP fetch failed: ${String(error)}`);
			await this.renderKey(contextId, ["ERR"], settings);
		} finally {
			state.isFetching = false;
		}
	}

	private async markSeenNow(contextId: string): Promise<void> {
		const state = this.contexts.get(contextId);
		if (!state || state.isFetching) {
			return;
		}
		const settings = state.settings;
		if (!settings.playerName.trim()) {
			await this.renderKey(contextId, ["SET RSN"], settings);
			return;
		}
		state.isFetching = true;
		await this.renderKey(contextId, ["..."], settings);
		try {
			const result = await this.fetchHiscore(settings);
			if (!result) {
				throw new Error("No hiscore data");
			}
			await this.setSnapshot(settings, result.totalXp);
			await this.renderKey(
				contextId,
				[settings.playerName, "+0 XP", "JUST NOW"],
				settings
			);
		} catch (error) {
			streamDeck.logger.error(`Daily XP mark seen failed: ${String(error)}`);
			await this.renderKey(contextId, ["ERR"], settings);
		} finally {
			state.isFetching = false;
		}
	}

	private async fetchHiscore(
		settings: ActionSettings
	): Promise<{ totalLevel: number; totalXp: number } | null> {
		const url = `https://secure.runescape.com/m=${settings.mode}/index_lite.ws?player=${encodeURIComponent(
			settings.playerName.trim()
		)}`;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 7000);
		try {
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const text = await response.text();
			const firstLine = text
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find((line) => line.length > 0);
			if (!firstLine) {
				throw new Error("Empty hiscore response");
			}
			const parts = firstLine.split(",");
			if (parts.length < 3) {
				throw new Error("Invalid hiscore response");
			}
			const totalLevel = Number.parseInt(parts[1], 10);
			const totalXp = Number.parseInt(parts[2], 10);
			if (!Number.isFinite(totalLevel) || !Number.isFinite(totalXp)) {
				throw new Error("Invalid hiscore values");
			}
			return { totalLevel, totalXp };
		} catch {
			return null;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private async updateSnapshot(
		settings: ActionSettings,
		totalXp: number
	): Promise<{ snapshot: SeenSnapshot; firstSeen: boolean }> {
		const globals = ((await streamDeck.settings.getGlobalSettings()) ?? {}) as GlobalSettings;
		const snapshots = { ...(globals.xpSinceSeenSnapshots ?? {}) };
		const key = this.buildSnapshotKey(settings);
		const now = new Date();
		const nowIso = now.toISOString();
		const today = this.getRunescapeDay(now);
		const existing = snapshots[key];
		let firstSeen = false;
		let snapshot: SeenSnapshot;

		if (!existing || totalXp < existing.latestXp) {
			firstSeen = true;
			snapshot = {
				playerName: settings.playerName.trim(),
				mode: settings.mode,
				baselineXp: totalXp,
				baselineSeenAt: nowIso,
				baselineDay: today,
				latestXp: totalXp,
				latestSeenAt: nowIso,
				latestDay: today,
				updatedAt: nowIso
			};
		} else {
			const latestDay = existing.latestDay || existing.baselineDay;
			const crossedIntoNewDay = latestDay !== today;
			snapshot = {
				...existing,
				playerName: settings.playerName.trim(),
				mode: settings.mode,
				baselineXp: crossedIntoNewDay ? existing.latestXp : existing.baselineXp,
				baselineSeenAt: crossedIntoNewDay
					? existing.latestSeenAt
					: existing.baselineSeenAt,
				baselineDay: crossedIntoNewDay ? latestDay : existing.baselineDay,
				latestXp: Math.max(existing.latestXp, totalXp),
				latestSeenAt: nowIso,
				latestDay: today,
				updatedAt: nowIso
			};
		}
		snapshots[key] = snapshot;
		await streamDeck.settings.setGlobalSettings({
			...globals,
			xpSinceSeenSnapshots: this.pruneSnapshots(snapshots)
		});
		return { snapshot, firstSeen };
	}

	private async setSnapshot(
		settings: ActionSettings,
		totalXp: number
	): Promise<void> {
		const globals = ((await streamDeck.settings.getGlobalSettings()) ?? {}) as GlobalSettings;
		const snapshots = { ...(globals.xpSinceSeenSnapshots ?? {}) };
		const key = this.buildSnapshotKey(settings);
		const now = new Date();
		const nowIso = now.toISOString();
		const today = this.getRunescapeDay(now);
		snapshots[key] = {
			playerName: settings.playerName.trim(),
			mode: settings.mode,
			baselineXp: totalXp,
			baselineSeenAt: nowIso,
			baselineDay: today,
			latestXp: totalXp,
			latestSeenAt: nowIso,
			latestDay: today,
			updatedAt: nowIso
		};
		await streamDeck.settings.setGlobalSettings({
			...globals,
			xpSinceSeenSnapshots: this.pruneSnapshots(snapshots)
		});
	}

	private pruneSnapshots(
		snapshots: Record<string, SeenSnapshot>
	): Record<string, SeenSnapshot> {
		return Object.fromEntries(
			Object.entries(snapshots)
				.sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
				.slice(0, MAX_SNAPSHOTS)
		);
	}

	private buildSnapshotKey(settings: ActionSettings): string {
		return `${settings.mode}:${settings.playerName.trim().toLowerCase()}`;
	}

	private getRunescapeDay(date = new Date()): string {
		return date.toISOString().slice(0, 10);
	}

	private async renderKey(
		contextId: string,
		lines: string[],
		settings: ActionSettings
	): Promise<void> {
		const state = this.contexts.get(contextId);
		if (!state) {
			return;
		}
		const maxChars = this.getMaxChars(settings.titleSize);
		const wrapped = this.wrapFirstLine(lines, maxChars);
		if (wrapped) {
			this.stopMarquee(contextId);
			await this.renderKeyStatic(contextId, wrapped, settings);
			return;
		}
		if (lines[0] && lines[0].length > maxChars) {
			this.startMarquee(contextId, lines, settings);
			return;
		}
		this.stopMarquee(contextId);
		await this.renderKeyStatic(contextId, lines, settings);
	}

	private async renderKeyStatic(
		contextId: string,
		lines: string[],
		settings: ActionSettings
	): Promise<void> {
		const state = this.contexts.get(contextId);
		if (!state) {
			return;
		}
		const image = this.buildSvgImage(lines, settings.titleColor, settings.titleSize, settings.titleBold);
		if (image) {
			await state.action.setImage(image, { target: 0 });
			await state.action.setTitle("", { target: 0 });
			return;
		}
		await state.action.setTitle(lines.join("\n"), { target: 0 });
	}

	private startMarquee(contextId: string, lines: string[], settings: ActionSettings): void {
		const state = this.contexts.get(contextId);
		if (!state) {
			return;
		}
		const full = lines[0];
		const maxChars = this.getMaxChars(settings.titleSize);
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
			this.renderKeyStatic(contextId, rendered, settings).catch((error) => {
				streamDeck.logger.error(`Daily XP marquee render failed: ${String(error)}`);
			});
		}, 1000);
	}

	private buildSvgImage(
		lines: string[],
		titleColor: string,
		titleSize: number,
		titleBold: boolean
	): string | null {
		const baseImage = this.getBaseImageData();
		if (!baseImage) {
			return null;
		}
		const size = 144;
		const safeLines = lines.map((line) => this.escapeXml(line));
		const baseFont = ALLOWED_SIZES.includes(titleSize) ? titleSize : 22;
		const fontSize =
			safeLines.length <= 1 ? baseFont + 4 : safeLines.length === 2 ? baseFont : baseFont - 4;
		const lineHeight = Math.round(fontSize * 1.2);
		const totalHeight = lineHeight * (safeLines.length - 1);
		const startY = size / 2 - totalHeight / 2;
		const textNodes = safeLines
			.map((line, index) => {
				const y = startY + index * lineHeight;
				return `<text x="${size / 2}" y="${y}" font-size="${fontSize}">${line}</text>`;
			})
			.join("");
		const weight = titleBold ? 700 : 400;
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><image href="data:image/png;base64,${baseImage}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice"/><g font-family="Trebuchet MS, Segoe UI, Arial, sans-serif" font-weight="${weight}" fill="${titleColor}" text-anchor="middle">${textNodes}</g></svg>`;
		return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
	}

	private getBaseImageData(): string | null {
		if (this.baseImageData) {
			return this.baseImageData;
		}
		try {
			const imagePath = path.resolve(
				__dirname,
				"..",
				"imgs",
				"actions",
				"leveltracker",
				"key.png"
			);
			const data = fs.readFileSync(imagePath);
			this.baseImageData = data.toString("base64");
			return this.baseImageData;
		} catch {
			return null;
		}
	}

	private escapeXml(value: string): string {
		return value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&apos;");
	}

	private truncateLine(value: string, max = 14): string {
		if (value.length <= max) {
			return value;
		}
		return `${value.slice(0, Math.max(0, max - 1))}...`;
	}

	private getMaxChars(titleSize: number): number {
		if (titleSize >= 28) return 9;
		if (titleSize >= 26) return 10;
		if (titleSize >= 24) return 11;
		if (titleSize >= 22) return 12;
		return 14;
	}

	private formatCompact(value: number): string {
		if (!Number.isFinite(value)) {
			return String(value);
		}
		const abs = Math.abs(value);
		const suffix = abs >= 1_000_000_000 ? "B" : abs >= 1_000_000 ? "M" : abs >= 1_000 ? "K" : "";
		const divisor =
			suffix === "B" ? 1_000_000_000 : suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;
		if (!suffix) {
			return this.numberFormatter.format(value);
		}
		const scaled = value / divisor;
		const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
		const text = rounded % 1 === 0 ? String(Math.trunc(rounded)) : String(rounded);
		return `${text}${suffix}`;
	}

	private formatSeenTime(isoValue: string): string {
		const date = new Date(isoValue);
		if (Number.isNaN(date.getTime())) {
			return "UNKNOWN";
		}
		const weekday = date
			.toLocaleDateString("en-US", { weekday: "short" })
			.toUpperCase();
		const time = date
			.toLocaleTimeString("en-US", {
				hour: "numeric",
				minute: "2-digit"
			})
			.replace(/\s/g, "")
			.replace("AM", "A")
			.replace("PM", "P");
		return `${weekday} ${time}`;
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
}
