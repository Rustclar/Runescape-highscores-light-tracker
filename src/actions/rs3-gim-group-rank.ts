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

type GroupMode = "regular" | "competitive";
type TeamSize = 2 | 3 | 4 | 5;

type GroupSettings = {
	groupName: string;
	mode: GroupMode;
	teamSize: TeamSize;
	showRank: boolean;
	showLevel: boolean;
	showXp: boolean;
	titleColor: string;
	titleSize: number;
};

const DEFAULT_SETTINGS: GroupSettings = {
	groupName: "",
	mode: "regular",
	teamSize: 3,
	showRank: true,
	showLevel: false,
	showXp: false,
	titleColor: "#000000",
	titleSize: 22
};

const ALLOWED_TEAM_SIZES: TeamSize[] = [2, 3, 4, 5];
const ALLOWED_MODES: GroupMode[] = ["regular", "competitive"];
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
const ALLOWED_TITLE_SIZES = [16, 18, 20, 22, 24, 26, 28];

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type CacheEntry = {
	expiresAt: number;
	data: GroupRankResult;
};

type GroupRankResult = {
	rank: number;
	level: number;
	xp: number;
};

type ContextState = {
	settings: GroupSettings;
	isFetching: boolean;
	action: KeyAction<GroupSettings>;
};

@action({ UUID: "com.rustin.rs3.leveltracker2.0.gimrank" })
export class Rs3GimGroupRank extends SingletonAction<GroupSettings> {
	private readonly contexts = new Map<string, ContextState>();
	private readonly cache = new Map<string, CacheEntry>();
	private readonly cacheTtlMs = 10 * 60 * 1000;
	private baseImageData?: string;

	override onWillAppear(ev: WillAppearEvent<GroupSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		const settings = this.normalizeSettings(ev.payload.settings);
		this.setContext(ev.action, settings);
		this.refresh(ev.action.id).catch((error) => {
			streamDeck.logger.error(`GIM rank refresh failed: ${String(error)}`);
		});
	}

	override onWillDisappear(ev: WillDisappearEvent<GroupSettings>): void {
		this.contexts.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<GroupSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		const settings = this.normalizeSettings(ev.payload.settings);
		this.setContext(ev.action, settings);
	}

	override onKeyDown(ev: KeyDownEvent<GroupSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		this.refresh(ev.action.id).catch((error) => {
			streamDeck.logger.error(`GIM rank refresh failed: ${String(error)}`);
		});
	}

	override async onSendToPlugin(
		ev: SendToPluginEvent<{ event: string; settings?: GroupSettings }, GroupSettings>
	): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		if (ev.payload.event === "saveSettings" && ev.payload.settings) {
			const settings = this.normalizeSettings(ev.payload.settings);
			this.setContext(ev.action, settings);
			await ev.action.setSettings(settings);
			await this.refresh(ev.action.id);
			return;
		}

		if (ev.payload.event === "testPull") {
			await this.refresh(ev.action.id);
		}
	}

	private normalizeSettings(settings?: Partial<GroupSettings>): GroupSettings {
		const merged: GroupSettings = {
			...DEFAULT_SETTINGS,
			...(settings ?? {})
		};
		const groupName = typeof merged.groupName === "string" ? merged.groupName.trim() : "";
		const teamSize = ALLOWED_TEAM_SIZES.includes(merged.teamSize) ? merged.teamSize : 3;
		const mode = ALLOWED_MODES.includes(merged.mode) ? merged.mode : "regular";
		const normalizedColor =
			typeof merged.titleColor === "string" ? merged.titleColor.trim() : "";
		const allowedColors = new Set(ALLOWED_COLORS.map((entry) => entry.value));
		const titleColor = allowedColors.has(normalizedColor)
			? normalizedColor
			: DEFAULT_SETTINGS.titleColor;
		const titleSize = ALLOWED_TITLE_SIZES.includes(merged.titleSize)
			? merged.titleSize
			: DEFAULT_SETTINGS.titleSize;
		return {
			groupName,
			teamSize,
			mode,
			showRank: Boolean(merged.showRank),
			showLevel: Boolean(merged.showLevel),
			showXp: Boolean(merged.showXp),
			titleColor,
			titleSize
		};
	}

	private setContext(action: KeyAction<GroupSettings>, settings: GroupSettings): void {
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

	private async refresh(contextId: string): Promise<void> {
		const state = this.contexts.get(contextId);
		if (!state || state.isFetching) {
			return;
		}

		const settings = state.settings;
		if (!settings.groupName) {
			await this.renderKey(contextId, ["SET GIM"], settings.titleColor, settings.titleSize);
			return;
		}

		state.isFetching = true;
		await this.renderKey(contextId, ["..."], settings.titleColor, settings.titleSize);

		try {
			const result = await this.getGroupRank(settings);
			if (!result) {
				throw new Error("Group rank not found");
			}
			const lines: string[] = [settings.groupName];
			if (settings.showRank) {
				lines.push(`RANK ${result.rank}`);
			}
			if (settings.showLevel) {
				lines.push(`TL ${result.level}`);
			}
			if (settings.showXp) {
				lines.push(`XP ${result.xp.toLocaleString("en-US")}`);
			}
			if (lines.length === 1) {
				lines.push(`RANK ${result.rank}`);
			}
			await this.renderKey(contextId, lines, settings.titleColor, settings.titleSize);
		} catch (error) {
			streamDeck.logger.error(`GIM rank fetch error: ${String(error)}`);
			await this.renderKey(contextId, ["ERR"], settings.titleColor, settings.titleSize);
		} finally {
			state.isFetching = false;
		}
	}

	private async getGroupRank(settings: GroupSettings): Promise<GroupRankResult | null> {
		const key = `${settings.mode}:${settings.teamSize}:${settings.groupName.toLowerCase()}`;
		const cached = this.cache.get(key);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.data;
		}

		const result =
			(await this.fetchGroupPage(settings)) ??
			(await this.searchListPages(settings));
		if (result) {
			this.cache.set(key, {
				data: result,
				expiresAt: Date.now() + this.cacheTtlMs
			});
		}
		return result;
	}

	private async fetchGroupPage(settings: GroupSettings): Promise<GroupRankResult | null> {
		const url = `https://rs.runescape.com/hiscores/group-ironman/${settings.mode}/${settings.teamSize}/${encodeURIComponent(
			settings.groupName
		)}`;
		const html = await this.fetchHtml(url);
		return this.extractRank(html, settings.groupName);
	}

	private async searchListPages(settings: GroupSettings): Promise<GroupRankResult | null> {
		for (let page = 1; page <= 200; page += 1) {
			const url = `https://rs.runescape.com/hiscores/group-ironman/${settings.mode}/${settings.teamSize}?page=${page}`;
			const html = await this.fetchHtml(url);
			const result = this.extractRank(html, settings.groupName);
			if (result) {
				return result;
			}
		}
		return null;
	}

	private async fetchHtml(url: string): Promise<string> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 7000);
		try {
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			return await response.text();
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private extractRank(html: string, groupName: string): GroupRankResult | null {
		if (!groupName.trim()) {
			return null;
		}
		return this.extractRankFromList(html, groupName);
	}

	private extractRankFromList(html: string, groupName: string): GroupRankResult | null {
		if (!html.includes("data-label=\"Rank\"") || !html.includes("data-label=\"Name\"")) {
			return null;
		}
		const target = groupName.trim().toLowerCase();
		const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
		let match: RegExpExecArray | null;
		while ((match = rowRegex.exec(html))) {
			const row = match[0];
			const nameMatch = row.match(/data-label="Name"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
			if (!nameMatch) {
				continue;
			}
			const name = this.cleanCell(nameMatch[1]).toLowerCase();
			if (name !== target) {
				continue;
			}
			const rankCell = row.match(/data-label="Rank"[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
			const levelCell = row.match(/data-label="Level[^"]*"[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
			const xpCell = row.match(/data-label="XP[^"]*"[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
			if (!rankCell || !levelCell || !xpCell) {
				return null;
			}
			const rank = this.toNumber(rankCell[1]);
			const level = this.toNumber(levelCell[1]);
			const xp = this.toNumber(xpCell[1]);
			if (!Number.isFinite(rank) || !Number.isFinite(level) || !Number.isFinite(xp)) {
				return null;
			}
			return { rank, level, xp };
		}
		return null;
	}

	private toNumber(value: string): number {
		return Number.parseInt(this.cleanCell(value).replace(/,/g, ""), 10);
	}

	private cleanCell(value: string): string {
		return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
	}

	private escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
		const baseFont = ALLOWED_TITLE_SIZES.includes(titleSize) ? titleSize : 22;
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
			streamDeck.logger.error(`GIM image load error: ${String(error)}`);
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
