import {
	action,
	DidReceiveSettingsEvent,
	KeyDownEvent,
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
	showXp: boolean;
	titleColor: string;
	titleSize: number;
};

const DEFAULT_SETTINGS: ActionSettings = {
	playerName: "",
	mode: "hiscore",
	refreshSeconds: 300,
	showXp: false,
	titleColor: "#000000",
	titleSize: 22
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ContextState = {
	settings: ActionSettings;
	timerId?: NodeJS.Timeout;
	isFetching: boolean;
	action: KeyAction<ActionSettings>;
};

@action({ UUID: "com.rustin.rs3.leveltracker2.0.leveltracker" })
export class Rs3LevelTracker extends SingletonAction<ActionSettings> {
	private readonly contexts = new Map<string, ContextState>();
	private readonly numberFormatter = new Intl.NumberFormat("en-US");
	private readonly logPath = this.resolveLogPath();
	private baseImageData?: string;

	override onWillAppear(ev: WillAppearEvent<ActionSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		this.log("willAppear", { context: ev.action.id, settings: ev.payload.settings });
		const settings = this.normalizeSettings(ev.payload.settings);
		this.setContext(ev.action, settings);
		this.startTimer(ev.action.id);
		this.refresh(ev.action.id).catch((error) => {
			console.error("Initial refresh failed", error);
		});
	}

	override onWillDisappear(ev: WillDisappearEvent<ActionSettings>): void {
		this.log("willDisappear", { context: ev.action.id });
		this.stopTimer(ev.action.id);
		this.contexts.delete(ev.action.id);
	}

	override onKeyDown(ev: KeyDownEvent<ActionSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		this.log("keyDown", { context: ev.action.id });
		this.refresh(ev.action.id).catch((error) => {
			console.error("Manual refresh failed", error);
		});
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ActionSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		this.log("didReceiveSettings", { context: ev.action.id, settings: ev.payload.settings });
		const settings = this.normalizeSettings(ev.payload.settings);
		this.setContext(ev.action, settings);
	}

	override async onSendToPlugin(
		ev: SendToPluginEvent<{ event: string; settings?: ActionSettings }, ActionSettings>
	): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		if (ev.payload.event === "saveSettings" && ev.payload.settings) {
			this.log("saveSettings", { context: ev.action.id, settings: ev.payload.settings });
			const settings = this.normalizeSettings(ev.payload.settings);
			this.setContext(ev.action, settings);
			await ev.action.setSettings(settings);
			this.startTimer(ev.action.id);
			return;
		}

		if (ev.payload.event === "testPull") {
			this.log("testPull", { context: ev.action.id });
			await this.refresh(ev.action.id);
		}
	}

	private normalizeSettings(settings?: Partial<ActionSettings>): ActionSettings {
		const merged: ActionSettings = {
			...DEFAULT_SETTINGS,
			...(settings ?? {})
		};
		const refreshSeconds = Number.isFinite(merged.refreshSeconds)
			? Math.max(30, Math.floor(merged.refreshSeconds))
			: DEFAULT_SETTINGS.refreshSeconds;
		const mode = ALLOWED_MODES.includes(merged.mode) ? merged.mode : "hiscore";
		const normalizedColor =
			typeof merged.titleColor === "string" ? merged.titleColor.trim() : "";
		const allowedColors = new Set(ALLOWED_COLORS.map((entry) => entry.value));
		const titleColor = allowedColors.has(normalizedColor)
			? normalizedColor
			: DEFAULT_SETTINGS.titleColor;
		const titleSize = ALLOWED_SIZES.includes(merged.titleSize)
			? merged.titleSize
			: DEFAULT_SETTINGS.titleSize;
		return {
			...merged,
			refreshSeconds,
			mode,
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
				isFetching: false,
				action
			});
		}
	}

	private startTimer(contextId: string): void {
		this.stopTimer(contextId);
		const state = this.contexts.get(contextId);
		if (!state) {
			return;
		}
		state.timerId = setInterval(() => {
			this.refresh(contextId).catch((error) => {
				console.error("Refresh failed", error);
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

	private async refresh(contextId: string): Promise<void> {
		const state = this.contexts.get(contextId);
		if (!state || state.isFetching) {
			return;
		}

		const settings = state.settings;
		if (!settings.playerName.trim()) {
			this.log("emptyPlayer", { context: contextId });
			await this.renderKey(contextId, ["SET RSN"], settings.titleColor, settings.titleSize);
			return;
		}

		state.isFetching = true;
		await this.renderKey(contextId, ["..."], settings.titleColor, settings.titleSize);

		try {
			let result = await this.fetchHiscore(settings);
			if (!result && settings.mode !== "hiscore") {
				result = await this.fetchHiscore({ ...settings, mode: "hiscore" });
			}
			if (!result) {
				throw new Error("No hiscore data");
			}
			const lines = [
				settings.playerName,
				`TL ${this.numberFormatter.format(result.totalLevel)}`
			];
			if (settings.showXp) {
				lines.push(`XP ${this.numberFormatter.format(result.totalXp)}`);
			}
			await this.renderKey(contextId, lines, settings.titleColor, settings.titleSize);
		} catch (error) {
			this.log("refreshError", { context: contextId, error: String(error) });
			console.error("Failed to fetch hiscore data", error);
			await this.renderKey(contextId, ["ERR"], settings.titleColor, settings.titleSize);
		} finally {
			state.isFetching = false;
		}
	}

	private async renderKey(
		contextId: string,
		lines: string[],
		titleColor: string,
		titleSize: number
	): Promise<void> {
		const state = this.contexts.get(contextId);
		if (!state) {
			return;
		}
		const image = this.buildSvgImage(lines, titleColor, titleSize);
		if (image) {
			await state.action.setImage(image, { target: 0 });
			await state.action.setTitle("", { target: 0 });
			return;
		}
		await state.action.setTitle(lines.join("\n"), { target: 0 });
	}

	private async fetchHiscore(
		settings: ActionSettings
	): Promise<{ totalLevel: number; totalXp: number } | null> {
		const url = this.buildUrl(settings.mode, settings.playerName);
		this.log("fetch", { url });
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 7000);
		try {
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const text = await response.text();
			const [firstLine] = text.trim().split(/\r?\n/);
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
		} catch (error) {
			this.log("fetchError", { error: String(error) });
			console.warn("Hiscore fetch failed", error);
			return null;
		} finally {
			clearTimeout(timeoutId);
		}
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
		try {
			fs.appendFileSync(this.logPath, `${line}\n`, "utf8");
		} catch (error) {
			streamDeck.logger.warn(`log write failed: ${String(error)}`);
		}
	}

	private buildUrl(mode: HiscoreMode, playerName: string): string {
		const encoded = encodeURIComponent(playerName.trim());
		return `https://secure.runescape.com/m=${mode}/index_lite.ws?player=${encoded}`;
	}

	private buildSvgImage(
		lines: string[],
		titleColor: string,
		titleSize: number
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
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><image href="data:image/png;base64,${baseImage}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice"/><g font-family="Trebuchet MS, Segoe UI, Arial, sans-serif" font-weight="700" fill="${titleColor}" text-anchor="middle">${textNodes}</g></svg>`;
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
		} catch (error) {
			this.log("imageLoadError", { error: String(error) });
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
}
