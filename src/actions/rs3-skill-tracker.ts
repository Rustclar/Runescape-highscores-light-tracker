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

type GameMode = "rs3" | "osrs";

type ActionSettings = {
	playerName: string;
	game: GameMode;
	skillKey: string;
	refreshSeconds: number;
	refreshPreset?: string;
	titleBold: boolean;
	titleColor: string;
	titleSize: number;
};

type SkillEntry = {
	key: string;
	label: string;
	apiName?: string;
};

const RS3_SKILLS: SkillEntry[] = [
	{ key: "overall", label: "Overall" },
	{ key: "attack", label: "Attack" },
	{ key: "defence", label: "Defence" },
	{ key: "strength", label: "Strength" },
	{ key: "constitution", label: "Constitution" },
	{ key: "ranged", label: "Ranged" },
	{ key: "prayer", label: "Prayer" },
	{ key: "magic", label: "Magic" },
	{ key: "cooking", label: "Cooking" },
	{ key: "woodcutting", label: "Woodcutting" },
	{ key: "fletching", label: "Fletching" },
	{ key: "fishing", label: "Fishing" },
	{ key: "firemaking", label: "Firemaking" },
	{ key: "crafting", label: "Crafting" },
	{ key: "smithing", label: "Smithing" },
	{ key: "mining", label: "Mining" },
	{ key: "herblore", label: "Herblore" },
	{ key: "agility", label: "Agility" },
	{ key: "thieving", label: "Thieving" },
	{ key: "slayer", label: "Slayer" },
	{ key: "farming", label: "Farming" },
	{ key: "runecrafting", label: "Runecrafting" },
	{ key: "hunter", label: "Hunter" },
	{ key: "construction", label: "Construction" },
	{ key: "summoning", label: "Summoning" },
	{ key: "dungeoneering", label: "Dungeoneering" },
	{ key: "divination", label: "Divination" },
	{ key: "invention", label: "Invention" },
	{ key: "archaeology", label: "Archaeology" },
	{ key: "necromancy", label: "Necromancy" }
];

const OSRS_SKILLS: SkillEntry[] = [
	{ key: "overall", label: "Overall" },
	{ key: "attack", label: "Attack", apiName: "Attack" },
	{ key: "defence", label: "Defence", apiName: "Defence" },
	{ key: "strength", label: "Strength", apiName: "Strength" },
	{ key: "hitpoints", label: "Hitpoints", apiName: "Hitpoints" },
	{ key: "ranged", label: "Ranged", apiName: "Ranged" },
	{ key: "prayer", label: "Prayer", apiName: "Prayer" },
	{ key: "magic", label: "Magic", apiName: "Magic" },
	{ key: "cooking", label: "Cooking", apiName: "Cooking" },
	{ key: "woodcutting", label: "Woodcutting", apiName: "Woodcutting" },
	{ key: "fletching", label: "Fletching", apiName: "Fletching" },
	{ key: "fishing", label: "Fishing", apiName: "Fishing" },
	{ key: "firemaking", label: "Firemaking", apiName: "Firemaking" },
	{ key: "crafting", label: "Crafting", apiName: "Crafting" },
	{ key: "smithing", label: "Smithing", apiName: "Smithing" },
	{ key: "mining", label: "Mining", apiName: "Mining" },
	{ key: "herblore", label: "Herblore", apiName: "Herblore" },
	{ key: "agility", label: "Agility", apiName: "Agility" },
	{ key: "thieving", label: "Thieving", apiName: "Thieving" },
	{ key: "slayer", label: "Slayer", apiName: "Slayer" },
	{ key: "farming", label: "Farming", apiName: "Farming" },
	{ key: "runecraft", label: "Runecraft", apiName: "Runecraft" },
	{ key: "hunter", label: "Hunter", apiName: "Hunter" },
	{ key: "construction", label: "Construction", apiName: "Construction" }
];

const DEFAULT_SETTINGS: ActionSettings = {
	playerName: "",
	game: "rs3",
	skillKey: "overall",
	refreshSeconds: 300,
	refreshPreset: "5",
	titleBold: true,
	titleColor: "#FFFFFF",
	titleSize: 24
};

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
	marqueeTimer?: NodeJS.Timeout;
	marqueeIndex: number;
	marqueeText?: string;
	marqueeLines?: string[];
};

@action({ UUID: "com.rustin.rs3.leveltracker2.0.skilltracker" })
export class Rs3SkillTracker extends SingletonAction<ActionSettings> {
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
			streamDeck.logger.error(`Skill refresh failed: ${String(error)}`);
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
			streamDeck.logger.error(`Skill refresh failed: ${String(error)}`);
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
		const game: GameMode = merged.game === "osrs" ? "osrs" : "rs3";
		const availableSkills = game === "osrs" ? OSRS_SKILLS : RS3_SKILLS;
		const skillKey = availableSkills.some((entry) => entry.key === merged.skillKey)
			? merged.skillKey
			: "overall";
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
			game,
			skillKey,
			refreshPreset:
				typeof merged.refreshPreset === "string" ? merged.refreshPreset : "5",
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
		} else {
			this.contexts.set(action.id, {
				settings,
				isFetching: false,
				action,
				marqueeIndex: 0
			});
		}
	}

	private startTimer(contextId: string): void {
		this.stopTimer(contextId);
		const state = this.contexts.get(contextId);
		if (!state) return;
		state.timerId = setInterval(() => {
			this.refresh(contextId).catch((error) => {
				streamDeck.logger.error(`Skill refresh failed: ${String(error)}`);
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
			const result =
				settings.game === "osrs"
					? await this.fetchOsrsSkill(settings)
					: await this.fetchRs3Skill(settings);
			if (!result) {
				throw new Error("No skill data");
			}
			const lines = [
				settings.playerName,
				result.skillLabel,
				`LVL ${result.level}`,
				`XP ${this.formatCompact(result.xp)}`
			];
			await this.renderKey(contextId, lines, settings);
		} catch (error) {
			streamDeck.logger.error(`Skill fetch failed: ${String(error)}`);
			await this.renderKey(contextId, ["ERR"], settings);
		} finally {
			state.isFetching = false;
		}
	}

	private async fetchRs3Skill(
		settings: ActionSettings
	): Promise<{ level: number; xp: number; skillLabel: string } | null> {
		const url = `https://secure.runescape.com/m=hiscore/index_lite.ws?player=${encodeURIComponent(
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
			const lines = text.trim().split(/\r?\n/);
			const index = RS3_SKILLS.findIndex((entry) => entry.key === settings.skillKey);
			if (index < 0 || index >= lines.length) {
				throw new Error("Skill index out of range");
			}
			const parts = lines[index].split(",");
			if (parts.length < 3) {
				throw new Error("Invalid hiscore row");
			}
			const level = Number.parseInt(parts[1], 10);
			const xp = Number.parseInt(parts[2], 10);
			if (!Number.isFinite(level) || !Number.isFinite(xp)) {
				throw new Error("Invalid skill values");
			}
			const skillLabel =
				RS3_SKILLS.find((entry) => entry.key === settings.skillKey)?.label ?? "Skill";
			return { level, xp, skillLabel };
		} catch {
			return null;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private async fetchOsrsSkill(
		settings: ActionSettings
	): Promise<{ level: number; xp: number; skillLabel: string } | null> {
		const url = `https://secure.runescape.com/m=hiscore_oldschool/index_lite.json?player=${encodeURIComponent(
			settings.playerName.trim()
		)}`;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 7000);
		try {
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const data = (await response.json()) as {
				skills?: { name?: string; level?: number; xp?: number }[];
			};
			const skills = data.skills ?? [];
		const targetEntry = OSRS_SKILLS.find((entry) => entry.key === settings.skillKey);
		const apiName = targetEntry?.apiName ?? targetEntry?.label ?? "Skill";
		const target = skills.find(
			(entry) => (entry.name ?? "").toLowerCase() === apiName.toLowerCase()
		);
			if (!target) {
				throw new Error("Skill not found");
			}
			const level = Number.parseInt(String(target.level ?? ""), 10);
			const xp = Number.parseInt(String(target.xp ?? ""), 10);
			if (!Number.isFinite(level) || !Number.isFinite(xp)) {
				throw new Error("Invalid skill values");
			}
			return { level, xp, skillLabel: targetEntry?.label ?? apiName };
		} catch {
			return null;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private async renderKey(
		contextId: string,
		lines: string[],
		settings: ActionSettings
	): Promise<void> {
		const state = this.contexts.get(contextId);
		if (!state) return;
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
		if (!state) return;
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
		if (!state) return;
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
				streamDeck.logger.error(`Skill marquee render failed: ${String(error)}`);
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
		return `${value.slice(0, Math.max(0, max - 1))}…`;
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
