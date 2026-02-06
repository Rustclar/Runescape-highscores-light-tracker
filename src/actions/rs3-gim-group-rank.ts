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
	game: "rs3" | "osrs";
	refreshMinutes: number;
	refreshPreset?: string;
	showRank: boolean;
	showLevel: boolean;
	showXp: boolean;
	titleBold: boolean;
	titleColor: string;
	titleSize: number;
	linkToMain: boolean;
};

const DEFAULT_SETTINGS: GroupSettings = {
	groupName: "",
	mode: "regular",
	teamSize: 3,
	game: "rs3",
	refreshMinutes: 10,
	showRank: true,
	showLevel: false,
	showXp: false,
	titleBold: true,
	titleColor: "#FFFFFF",
	titleSize: 24,
	linkToMain: false
};

const ALLOWED_TEAM_SIZES: TeamSize[] = [2, 3, 4, 5];
const ALLOWED_MODES: GroupMode[] = ["regular", "competitive"];
const ALLOWED_GAMES = ["rs3", "osrs"] as const;
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
const RELEASES_URL = "https://github.com/Rustclar/Runescape-highscores-light-tracker/releases/latest";
const RELEASES_API = "https://api.github.com/repos/Rustclar/Runescape-highscores-light-tracker/releases/latest";

type CacheEntry = {
	expiresAt: number;
	data: GroupRankResultWithName;
};

type GroupRankResult = {
	rank: number;
	level: number;
	xp: number;
};

type GroupRankResultWithName = GroupRankResult & {
	name: string;
};

type ContextState = {
	settings: GroupSettings;
	isFetching: boolean;
	action: KeyAction<GroupSettings>;
	timerId?: NodeJS.Timeout;
	marqueeTimer?: NodeJS.Timeout;
	marqueeIndex: number;
	marqueeText?: string;
	marqueeLines?: string[];
};

class Rs3GimGroupRankBase extends SingletonAction<GroupSettings> {
	private readonly contexts = new Map<string, ContextState>();
	private readonly cache = new Map<string, CacheEntry>();
	private readonly cacheTtlMs = 10 * 60 * 1000;
	private baseImageData?: string;
	private readonly neighborOffset: number;
	private readonly defaultLinkToMain: boolean;
	private readonly isMain: boolean;
	private globalMainSettings?: GroupSettings;

	constructor(neighborOffset = 0, defaultLinkToMain = false, isMain = false) {
		super();
		this.neighborOffset = neighborOffset;
		this.defaultLinkToMain = defaultLinkToMain;
		this.isMain = isMain;
		streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
			const settings = ev.settings as { gimMain?: Partial<GroupSettings> };
			if (settings?.gimMain) {
				this.globalMainSettings = this.normalizeSettings(
					settings.gimMain,
					this.defaultLinkToMain
				);
				this.refreshLinkedContexts().catch((error) => {
					streamDeck.logger.error(`GIM global refresh failed: ${String(error)}`);
				});
			}
		});
	}

	override onWillAppear(ev: WillAppearEvent<GroupSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		const settings = this.normalizeSettings(ev.payload.settings, this.defaultLinkToMain);
		this.setContext(ev.action, settings);
		this.loadGlobalSettings().catch((error) => {
			streamDeck.logger.error(`GIM global load failed: ${String(error)}`);
		});
		this.updateTimer(ev.action.id).catch((error) => {
			streamDeck.logger.error(`GIM timer update failed: ${String(error)}`);
		});
		this.refresh(ev.action.id).catch((error) => {
			streamDeck.logger.error(`GIM rank refresh failed: ${String(error)}`);
		});
	}

	override onWillDisappear(ev: WillDisappearEvent<GroupSettings>): void {
		this.stopTimer(ev.action.id);
		this.stopMarquee(ev.action.id);
		this.contexts.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<GroupSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		const settings = this.normalizeSettings(ev.payload.settings, this.defaultLinkToMain);
		this.setContext(ev.action, settings);
		this.persistMainSettings(settings).catch((error) => {
			streamDeck.logger.error(`GIM global save failed: ${String(error)}`);
		});
		this.updateTimer(ev.action.id).catch((error) => {
			streamDeck.logger.error(`GIM timer update failed: ${String(error)}`);
		});
	}

	override onKeyDown(ev: KeyDownEvent<GroupSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		(async () => {
			const state = this.contexts.get(ev.action.id);
			const settings = state ? await this.resolveSettings(state.settings) : null;
			if (settings) {
				if (this.neighborOffset === 0 && settings.groupName) {
					await streamDeck.system.openUrl(this.buildDetailUrl(settings));
				} else if (this.neighborOffset !== 0) {
					const neighbor = await this.getGroupRank(settings, this.neighborOffset);
					if (neighbor?.name) {
						await streamDeck.system.openUrl(
							this.buildDetailUrl({ ...settings, groupName: neighbor.name })
						);
					}
				}
			}
			await this.refresh(ev.action.id);
		})().catch((error) => {
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
			const settings = this.normalizeSettings(ev.payload.settings, this.defaultLinkToMain);
			this.setContext(ev.action, settings);
			await ev.action.setSettings(settings);
			await this.persistMainSettings(settings);
			await this.updateTimer(ev.action.id);
			await this.refresh(ev.action.id);
			return;
		}

		if (ev.payload.event === "testPull") {
			streamDeck.logger.info(`GIM testPull ${ev.action.id}`);
			await this.refresh(ev.action.id);
		}

		if (ev.payload.event === "refresh") {
			streamDeck.logger.info(`GIM refresh ${ev.action.id}`);
			await this.refresh(ev.action.id);
		}
		if (ev.payload.event === "checkUpdate") {
			await this.handleUpdateCheck();
		}
		if (ev.payload.event === "openRelease") {
			await streamDeck.system.openUrl(RELEASES_URL);
		}
	}

	private normalizeSettings(
		settings?: Partial<GroupSettings>,
		defaultLinkToMain = false
	): GroupSettings {
		const merged: GroupSettings = {
			...DEFAULT_SETTINGS,
			...(settings ?? {})
		};
		const groupName = typeof merged.groupName === "string" ? merged.groupName.trim() : "";
		const teamSize = ALLOWED_TEAM_SIZES.includes(merged.teamSize) ? merged.teamSize : 3;
		const mode = ALLOWED_MODES.includes(merged.mode) ? merged.mode : "regular";
		const game = ALLOWED_GAMES.includes(merged.game) ? merged.game : "rs3";
		const refreshMinutes = Number.isFinite(merged.refreshMinutes)
			? Math.max(1, Math.floor(merged.refreshMinutes))
			: DEFAULT_SETTINGS.refreshMinutes;
		const titleBold = Boolean(merged.titleBold);
		const normalizedColor =
			typeof merged.titleColor === "string" ? merged.titleColor.trim() : "";
		const allowedColors = new Set(ALLOWED_COLORS.map((entry) => entry.value));
		const titleColor = allowedColors.has(normalizedColor)
			? normalizedColor
			: DEFAULT_SETTINGS.titleColor;
		const titleSize = ALLOWED_TITLE_SIZES.includes(merged.titleSize)
			? merged.titleSize
			: DEFAULT_SETTINGS.titleSize;
		const linkToMain = defaultLinkToMain ? true : Boolean(merged.linkToMain);
		return {
			groupName,
			teamSize,
			mode,
			game,
			refreshMinutes,
			refreshPreset: typeof merged.refreshPreset === "string" ? merged.refreshPreset : undefined,
			showRank: Boolean(merged.showRank),
			showLevel: Boolean(merged.showLevel),
			showXp: Boolean(merged.showXp),
			titleBold,
			titleColor,
			titleSize,
			linkToMain
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
				action,
				marqueeIndex: 0
			});
		}
	}

	private async updateTimer(contextId: string): Promise<void> {
		this.stopTimer(contextId);
		const state = this.contexts.get(contextId);
		if (!state) {
			return;
		}
		const settings = await this.resolveSettings(state.settings);
		state.timerId = setInterval(() => {
			this.refresh(contextId).catch((error) => {
				streamDeck.logger.error(`GIM refresh failed: ${String(error)}`);
			});
		}, settings.refreshMinutes * 60 * 1000);
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

		this.cache.clear();
		const settings = await this.resolveSettings(state.settings);
		if (!settings.groupName) {
			await this.renderKey(
				contextId,
				["SET GIM"],
				settings.titleColor,
				settings.titleSize,
				settings.titleBold
			);
			return;
		}

		state.isFetching = true;
		await this.renderKey(
			contextId,
			["..."],
			settings.titleColor,
			settings.titleSize,
			settings.titleBold
		);

		try {
			const result = await this.getGroupRank(settings, this.neighborOffset);
			if (!result) {
				throw new Error("Group rank not found");
			}
			const maxChars = this.getMaxChars(settings.titleSize);
			const titleName = this.neighborOffset === 0 ? settings.groupName : result.name;
			const lines: string[] = [titleName];
			if (settings.showRank) {
				lines.push(this.truncateLine(`RANK ${result.rank}`, maxChars));
			}
			if (settings.showLevel) {
				lines.push(this.truncateLine(`TL ${result.level}`, maxChars));
			}
			if (settings.showXp) {
				lines.push(this.truncateLine(`XP ${this.formatCompact(result.xp)}`, maxChars));
			}
			if (lines.length === 1) {
				lines.push(this.truncateLine(`RANK ${result.rank}`, maxChars));
			}
			await this.renderKey(
				contextId,
				lines,
				settings.titleColor,
				settings.titleSize,
				settings.titleBold
			);
		} catch (error) {
			streamDeck.logger.error(`GIM rank fetch error: ${String(error)}`);
			await this.renderKey(
				contextId,
				["ERR"],
				settings.titleColor,
				settings.titleSize,
				settings.titleBold
			);
		} finally {
			state.isFetching = false;
		}
	}

	private async getGroupRank(
		settings: GroupSettings,
		offset: number
	): Promise<GroupRankResultWithName | null> {
		const key = `${settings.mode}:${settings.teamSize}:${settings.groupName.toLowerCase()}:${offset}`;
		const cached = this.cache.get(key);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.data;
		}

		const result = await this.findGroupWithNeighbor(settings, offset);
		if (result) {
			this.cache.set(key, {
				data: result,
				expiresAt: Date.now() + this.cacheTtlMs
			});
		}
		return result;
	}

	private async findGroupWithNeighbor(
		settings: GroupSettings,
		offset: number
	): Promise<GroupRankResultWithName | null> {
		if (offset === 0) {
			const direct = await this.fetchGroupPageRank(settings);
			if (direct) {
				return direct;
			}
		}
		for (let page = 1; page <= 200; page += 1) {
			const url = this.buildListUrl(settings, page);
			const html = await this.fetchHtml(url);
			const entries = this.parseListEntries(html);
			if (!entries.length) {
				continue;
			}
			const target = settings.groupName.trim().toLowerCase();
			const index = entries.findIndex((entry) => entry.name.toLowerCase() === target);
			if (index < 0) {
				continue;
			}
			const targetIndex = index + offset;
			if (targetIndex >= 0 && targetIndex < entries.length) {
				return entries[targetIndex];
			}
			if (offset < 0 && page > 1) {
				const prevUrl = this.buildListUrl(settings, page - 1);
				const prevHtml = await this.fetchHtml(prevUrl);
				const prevEntries = this.parseListEntries(prevHtml);
				return prevEntries.length ? prevEntries[prevEntries.length - 1] : null;
			}
			if (offset > 0 && page < 200) {
				const nextUrl = this.buildListUrl(settings, page + 1);
				const nextHtml = await this.fetchHtml(nextUrl);
				const nextEntries = this.parseListEntries(nextHtml);
				return nextEntries.length ? nextEntries[0] : null;
			}
			return null;
		}
		return null;
	}

	private async fetchGroupPageRank(
		settings: GroupSettings
	): Promise<GroupRankResultWithName | null> {
		const url = this.buildDetailUrl(settings);
		const html = await this.fetchHtml(url);
		const entries = this.parseListEntries(html);
		if (!entries.length) {
			return null;
		}
		const target = settings.groupName.trim().toLowerCase();
		const found = entries.find((entry) => entry.name.toLowerCase() === target);
		return found ?? null;
	}

	private async resolveSettings(settings: GroupSettings): Promise<GroupSettings> {
		if (this.neighborOffset !== 0) {
			if (!this.globalMainSettings) {
				await this.loadGlobalSettings();
			}
			if (this.globalMainSettings) {
				return {
					...this.globalMainSettings,
					showRank: settings.showRank,
					showLevel: settings.showLevel,
					showXp: settings.showXp,
					titleBold: settings.titleBold,
					titleColor: settings.titleColor,
					titleSize: settings.titleSize
				};
			}
		}
		return settings;
	}

	private async loadGlobalSettings(): Promise<void> {
		const globals = (await streamDeck.settings.getGlobalSettings()) as {
			gimMain?: Partial<GroupSettings>;
		};
		if (globals?.gimMain) {
			this.globalMainSettings = this.normalizeSettings(
				globals.gimMain,
				this.defaultLinkToMain
			);
		}
	}

	private async persistMainSettings(settings: GroupSettings): Promise<void> {
		if (!this.isMain) {
			return;
		}
		await streamDeck.settings.setGlobalSettings({ gimMain: settings });
	}

	private async refreshLinkedContexts(): Promise<void> {
		if (this.neighborOffset === 0) {
			return;
		}
		const refreshes = Array.from(this.contexts.keys()).map((contextId) =>
			this.refresh(contextId)
		);
		await Promise.allSettled(refreshes);
		const timers = Array.from(this.contexts.keys()).map((contextId) =>
			this.updateTimer(contextId)
		);
		await Promise.allSettled(timers);
	}

	private buildListUrl(settings: GroupSettings, page: number): string {
		if (settings.game === "osrs") {
			return `https://secure.runescape.com/m=hiscore_oldschool/group-ironman/${settings.mode}/${settings.teamSize}?page=${page}`;
		}
		return `https://rs.runescape.com/hiscores/group-ironman/${settings.mode}/${settings.teamSize}?page=${page}`;
	}

	private buildDetailUrl(settings: GroupSettings): string {
		const encoded = encodeURIComponent(settings.groupName);
		if (settings.game === "osrs") {
			return `https://secure.runescape.com/m=hiscore_oldschool/group-ironman/${settings.mode}/${settings.teamSize}/${encoded}`;
		}
		return `https://rs.runescape.com/hiscores/group-ironman/${settings.mode}/${settings.teamSize}/${encoded}`;
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

	private toNumber(value: string): number {
		return Number.parseInt(this.cleanCell(value).replace(/,/g, ""), 10);
	}

	private parseListEntries(html: string): GroupRankResultWithName[] {
		const entries: GroupRankResultWithName[] = [];
		const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
		let match: RegExpExecArray | null;
		while ((match = rowRegex.exec(html))) {
			const row = match[0];
			const nameMatch = row.match(/data-label="Name"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
			if (!nameMatch) {
				continue;
			}
			const name = this.cleanCell(nameMatch[1]);
			const rankCell = row.match(/data-label="Rank"[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
			const levelCell = row.match(/data-label="Level[^"]*"[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
			const xpCell = row.match(/data-label="XP[^"]*"[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
			if (!rankCell || !levelCell || !xpCell) {
				continue;
			}
			const rank = this.toNumber(rankCell[1]);
			const level = this.toNumber(levelCell[1]);
			const xp = this.toNumber(xpCell[1]);
			if (!Number.isFinite(rank) || !Number.isFinite(level) || !Number.isFinite(xp)) {
				continue;
			}
			entries.push({ name, rank, level, xp });
		}
		return entries;
	}

	private cleanCell(value: string): string {
		return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
	}

	private async handleUpdateCheck(): Promise<void> {
		try {
			const response = await fetch(RELEASES_API, {
				headers: { "User-Agent": "rs3-level-tracker" }
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const data = (await response.json()) as { tag_name?: string; html_url?: string };
			const latestTag = typeof data.tag_name === "string" ? data.tag_name : "";
			const latest = latestTag.replace(/^v/i, "");
			const current = this.getCurrentVersion();
			const updateAvailable = this.compareVersions(latest, current) > 0;
			if (streamDeck.ui.current) {
				await streamDeck.ui.current.sendToPropertyInspector({
					event: "updateCheck",
					current,
					latest: latest || latestTag || "unknown",
					updateAvailable,
					url: data.html_url ?? RELEASES_URL
				});
			}
		} catch (error) {
			streamDeck.logger.warn(`update check failed: ${String(error)}`);
			if (streamDeck.ui.current) {
				await streamDeck.ui.current.sendToPropertyInspector({
					event: "updateCheck",
					current: this.getCurrentVersion(),
					latest: "unknown",
					updateAvailable: false,
					url: RELEASES_URL
				});
			}
		}
	}

	private getCurrentVersion(): string {
		try {
			const manifestPath = path.resolve(__dirname, "..", "manifest.json");
			const data = fs.readFileSync(manifestPath, "utf8");
			const manifest = JSON.parse(data) as { Version?: string };
			return manifest.Version ?? "unknown";
		} catch {
			return "unknown";
		}
	}

	private compareVersions(left: string, right: string): number {
		const parse = (value: string) =>
			value
				.split(".")
				.map((part) => Number.parseInt(part, 10))
				.filter((num) => Number.isFinite(num));
		const a = parse(left);
		const b = parse(right);
		const max = Math.max(a.length, b.length);
		for (let i = 0; i < max; i += 1) {
			const av = a[i] ?? 0;
			const bv = b[i] ?? 0;
			if (av > bv) return 1;
			if (av < bv) return -1;
		}
		return 0;
	}

	private escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	private async renderKey(
		contextId: string,
		lines: string[],
		titleColor: string,
		titleSize: number,
		titleBold: boolean
	): Promise<void> {
		const state = this.contexts.get(contextId);
		if (!state) {
			return;
		}
		const maxChars = this.getMaxChars(titleSize);
		const wrapped = this.wrapFirstLine(lines, maxChars);
		if (wrapped) {
			this.stopMarquee(contextId);
			await this.renderKeyStatic(contextId, wrapped, titleColor, titleSize, titleBold);
			return;
		}
		if (lines[0] && lines[0].length > maxChars) {
			this.startMarquee(contextId, lines, titleColor, titleSize, titleBold);
			return;
		}
		this.stopMarquee(contextId);
		await this.renderKeyStatic(contextId, lines, titleColor, titleSize, titleBold);
	}

	private async renderKeyStatic(
		contextId: string,
		lines: string[],
		titleColor: string,
		titleSize: number,
		titleBold: boolean
	): Promise<void> {
		const state = this.contexts.get(contextId);
		if (!state) {
			return;
		}
		const image = this.buildSvgImage(lines, titleColor, titleSize, titleBold);
		if (image) {
			await state.action.setImage(image, { target: 0 });
			await state.action.setTitle("", { target: 0 });
			return;
		}
		await state.action.setTitle(lines.join("\n"), { target: 0 });
	}

	private startMarquee(
		contextId: string,
		lines: string[],
		titleColor: string,
		titleSize: number,
		titleBold: boolean
	): void {
		const state = this.contexts.get(contextId);
		if (!state) {
			return;
		}
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
			const head = loop.slice(offset, offset + 14);
			state.marqueeIndex += 1;
			const rendered = [head, ...(state.marqueeLines ?? [])];
			this.renderKeyStatic(contextId, rendered, titleColor, titleSize, titleBold).catch(
				(error) => {
				streamDeck.logger.error(`GIM marquee render failed: ${String(error)}`);
			});
		}, 500);
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
			return value.toLocaleString("en-US");
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

@action({ UUID: "com.rustin.rs3.leveltracker2.0.gimrank" })
export class Rs3GimGroupRank extends Rs3GimGroupRankBase {
	constructor() {
		super(0, false, true);
	}
}

@action({ UUID: "com.rustin.rs3.leveltracker2.0.gimrank.above.linked" })
export class Rs3GimGroupRankAboveLinked extends Rs3GimGroupRankBase {
	constructor() {
		super(-1, true, false);
	}
}

@action({ UUID: "com.rustin.rs3.leveltracker2.0.gimrank.below.linked" })
export class Rs3GimGroupRankBelowLinked extends Rs3GimGroupRankBase {
	constructor() {
		super(1, true, false);
	}
}

@action({ UUID: "com.rustin.rs3.leveltracker2.0.gimrank.above" })
export class Rs3GimGroupRankAbove extends Rs3GimGroupRankBase {
	constructor() {
		super(-1, false, false);
	}
}

@action({ UUID: "com.rustin.rs3.leveltracker2.0.gimrank.below" })
export class Rs3GimGroupRankBelow extends Rs3GimGroupRankBase {
	constructor() {
		super(1, false, false);
	}
}

@action({ UUID: "com.rustin.rs3.leveltracker2.0.gimrank.other" })
export class Rs3GimGroupRankOther extends Rs3GimGroupRankBase {
	constructor() {
		super(0, false, false);
	}
}
