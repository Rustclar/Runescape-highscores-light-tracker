import streamDeck from "@elgato/streamdeck";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setUpdateAvailable } from "./update-state";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASES_URL =
	"https://github.com/Rustclar/Runescape-highscores-light-tracker/releases/latest";
const RELEASES_API =
	"https://api.github.com/repos/Rustclar/Runescape-highscores-light-tracker/releases/latest";

const getCurrentVersion = (): string => {
	try {
		const manifestPath = path.resolve(__dirname, "..", "manifest.json");
		const data = fs.readFileSync(manifestPath, "utf8");
		const manifest = JSON.parse(data) as { Version?: string };
		return manifest.Version ?? "unknown";
	} catch {
		return "unknown";
	}
};

const compareVersions = (left: string, right: string): number => {
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
};

export const checkForUpdate = async (): Promise<void> => {
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
		const current = getCurrentVersion();
		const updateAvailable = compareVersions(latest, current) > 0;
		setUpdateAvailable(updateAvailable);
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
		setUpdateAvailable(false);
		if (streamDeck.ui.current) {
			await streamDeck.ui.current.sendToPropertyInspector({
				event: "updateCheck",
				current: getCurrentVersion(),
				latest: "unknown",
				updateAvailable: false,
				url: RELEASES_URL
			});
		}
	}
};
