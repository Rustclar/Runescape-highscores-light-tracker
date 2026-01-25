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
	useGimPlayers: boolean;
	gimPlayerName: string;
	mode: HiscoreMode;
	refreshSeconds: number;
	showXp: boolean;
	titleBold: boolean;
	titleColor: string;
	titleSize: number;
};

type GimGroupSettings = {
	groupName: string;
	mode: "regular" | "competitive";
	teamSize: 2 | 3 | 4 | 5;
	game: "rs3" | "osrs";
};

const DEFAULT_SETTINGS: ActionSettings = {
	playerName: "",
	useGimPlayers: false,
	gimPlayerName: "",
	mode: "hiscore",
	refreshSeconds: 300,
	showXp: false,
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
		this.stopMarquee(ev.action.id);
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
		ev: SendToPluginEvent<
			{ event: string; settings?: ActionSettings; gimSettings?: GimGroupSettings },
			ActionSettings
		>
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
		if (ev.payload.event === "refresh") {
			this.log("refresh", { context: ev.action.id });
			await this.refresh(ev.action.id);
		}
		if (ev.payload.event === "requestGimMembers" && ev.payload.gimSettings) {
			this.log("gimMembersRequest", { context: ev.action.id, source: "payload" });
			const members = await this.fetchGimMembers(ev.payload.gimSettings);
			if (streamDeck.ui.current) {
				await streamDeck.ui.current.sendToPropertyInspector({
					event: "gimMembers",
					members,
					groupName: ev.payload.gimSettings.groupName
				});
			}
		}
		if (ev.payload.event === "requestGimMembers" && !ev.payload.gimSettings) {
			this.log("gimMembersRequest", { context: ev.action.id, source: "globals" });
			const globals = (await streamDeck.settings.getGlobalSettings()) as {
				gimMain?: Partial<GimGroupSettings>;
			};
			const main = globals?.gimMain;
			if (!main?.groupName) {
				this.log("gimMembersMissingGlobals");
				return;
			}
			const resolved: GimGroupSettings = {
				groupName: main.groupName ?? "",
				mode: main.mode ?? "regular",
				teamSize: (main.teamSize as GimGroupSettings["teamSize"]) ?? 3,
				game: main.game ?? "rs3"
			};
			const members = await this.fetchGimMembers(resolved);
			if (streamDeck.ui.current) {
				await streamDeck.ui.current.sendToPropertyInspector({
					event: "gimMembers",
					members,
					groupName: resolved.groupName
				});
			}
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
		const titleBold = Boolean(merged.titleBold);
		const titleSize = ALLOWED_SIZES.includes(merged.titleSize)
			? merged.titleSize
			: DEFAULT_SETTINGS.titleSize;
		return {
			...merged,
			useGimPlayers: Boolean(merged.useGimPlayers),
			gimPlayerName: typeof merged.gimPlayerName === "string" ? merged.gimPlayerName : "",
			refreshSeconds,
			mode,
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
			this.log("emptyPlayer", { context: contextId });
			await this.renderKey(
				contextId,
				["SET RSN"],
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
			let result = await this.fetchHiscore(settings);
			if (!result && settings.mode !== "hiscore") {
				result = await this.fetchHiscore({ ...settings, mode: "hiscore" });
			}
			if (!result) {
				throw new Error("No hiscore data");
			}
			const lines = [
				settings.playerName,
				this.truncateLine(`TL ${this.numberFormatter.format(result.totalLevel)}`)
			];
			if (settings.showXp) {
				lines.push(this.truncateLine(`XP ${this.numberFormatter.format(result.totalXp)}`));
			}
			await this.renderKey(
				contextId,
				lines,
				settings.titleColor,
				settings.titleSize,
				settings.titleBold
			);
		} catch (error) {
			this.log("refreshError", { context: contextId, error: String(error) });
			console.error("Failed to fetch hiscore data", error);
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
		if (lines[0] && lines[0].length > 14) {
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
				console.error("Marquee render failed", error);
			});
		}, 500);
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

	private async fetchGimMembers(settings: GimGroupSettings): Promise<string[]> {
		if (!settings.groupName.trim()) {
			return [];
		}
		try {
			const urls = [this.buildGimDetailUrl(settings), this.buildGimDetailUrlAlt(settings)];
			for (const url of urls) {
				const html = await this.fetchHtml(url);
				const members = this.parseMemberNames(html, settings.groupName);
				this.log("gimMembersParse", {
					url,
					count: members.length
				});
				if (members.length) {
					return members.slice(0, 50);
				}
			}
			return [];
		} catch (error) {
			this.log("gimMembersError", { error: String(error) });
			return [];
		}
	}

	private buildGimDetailUrl(settings: GimGroupSettings): string {
		const encoded = encodeURIComponent(settings.groupName.trim());
		if (settings.game === "osrs") {
			return `https://secure.runescape.com/m=hiscore_oldschool/group-ironman/${settings.mode}/${settings.teamSize}/${encoded}`;
		}
		return `https://rs.runescape.com/hiscores/group-ironman/${settings.mode}/${settings.teamSize}/${encoded}`;
	}

	private buildGimDetailUrlAlt(settings: GimGroupSettings): string {
		const encoded = encodeURIComponent(settings.groupName.trim());
		const sizeLabel = `${settings.teamSize}-player`;
		if (settings.game === "osrs") {
			return `https://secure.runescape.com/m=hiscore_oldschool/group-ironman/${settings.mode}/${sizeLabel}/${encoded}`;
		}
		return `https://rs.runescape.com/hiscores/group-ironman/${settings.mode}/${sizeLabel}/${encoded}`;
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

	private parseMemberNames(html: string, groupName: string): string[] {
		const entries = new Set<string>();
		const normalizedGroup = groupName.trim().toLowerCase();

		const addCandidate = (raw: string) => {
			const name = this.cleanCell(raw);
			if (!name) return;
			const lower = name.toLowerCase();
			if (lower === normalizedGroup) return;
			if (
				[
					"home",
					"hiscores",
					"group ironman",
					"competitive group ironman",
					"back to table",
					"terms & conditions",
					"privacy policy",
					"cookie policy",
					"manage cookies",
					"jagex ltd.",
					"do not sell or share my personal information"
				].includes(lower)
			) {
				return;
			}
			if (name.length < 2) {
				return;
			}
			entries.add(name);
		};

		const jsonMatch = html.match(/"members"\s*:\s*\[([\s\S]*?)\]/i);
		if (jsonMatch) {
			const memberRegex = /"([^"]+)"/g;
			let memberMatch: RegExpExecArray | null;
			while ((memberMatch = memberRegex.exec(jsonMatch[1]))) {
				addCandidate(memberMatch[1]);
			}
		}

		const memberSpanRegex =
			/<span[^>]*class="[^"]*GroupMember-module__[^"]*__memberNameGold[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
		let spanMatch: RegExpExecArray | null;
		while ((spanMatch = memberSpanRegex.exec(html))) {
			addCandidate(spanMatch[1]);
		}

		const sectionMatch = html.match(/>Members<\/[^>]+>([\s\S]{0,8000})/i);
		if (sectionMatch) {
			const section = sectionMatch[1];
			const anchorRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
			let anchorMatch: RegExpExecArray | null;
			while ((anchorMatch = anchorRegex.exec(section))) {
				addCandidate(anchorMatch[1]);
			}
		}

		const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
		let match: RegExpExecArray | null;
		while ((match = rowRegex.exec(html))) {
			const row = match[0];
			const nameMatches = [
				/data-label="Name"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi,
				/data-label="Player"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi,
				/data-label="Members?"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi
			];
			nameMatches.forEach((regex) => {
				let nameMatch: RegExpExecArray | null;
				while ((nameMatch = regex.exec(row))) {
					addCandidate(nameMatch[1]);
				}
			});
		}

		const hrefRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
		let hrefMatch: RegExpExecArray | null;
		while ((hrefMatch = hrefRegex.exec(html))) {
			const href = hrefMatch[1];
			const text = hrefMatch[2];
			if (!/hiscore|hiscores|player=/i.test(href)) {
				continue;
			}
			const playerParam = href.match(/[?&]player=([^&]+)/i);
			if (playerParam?.[1]) {
				try {
					addCandidate(decodeURIComponent(playerParam[1].replace(/\+/g, " ")));
				} catch {
					addCandidate(playerParam[1]);
				}
				continue;
			}
			const pathPlayer = href.match(/\/player\/([^\s/?#]+)/i);
			if (pathPlayer?.[1]) {
				try {
					addCandidate(decodeURIComponent(pathPlayer[1].replace(/\+/g, " ")));
				} catch {
					addCandidate(pathPlayer[1]);
				}
				continue;
			}
			addCandidate(text);
		}

		return Array.from(entries);
	}

	private cleanCell(value: string): string {
		return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
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

	private truncateLine(value: string, max = 14): string {
		if (value.length <= max) {
			return value;
		}
		return `${value.slice(0, Math.max(0, max - 1))}…`;
	}
}
