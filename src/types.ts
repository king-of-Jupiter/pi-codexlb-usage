import type { Window } from "./render.ts";

/** One usage subscription (here: a codex-lb balancer, plus header-seen providers) and its quota windows. */
export interface Subscription {
	/** Provider id: "codexlb", "anthropic", "openai-codex", … */
	provider: string;
	/** Display name, e.g. "CodexLB", "Claude", "ChatGPT". */
	name: string;
	windows: Window[];
	/** Unix seconds when this data was observed. */
	updatedAt: number;
	/** Where it came from: "codexlb-api" | "headers". */
	source: string;
}

export const PROVIDER_NAMES: Record<string, string> = {
	codexlb: "CodexLB",
	anthropic: "Claude",
	"openai-codex": "ChatGPT",
	"github-copilot": "Copilot",
	"google-gemini-cli": "Gemini",
	"google-antigravity": "Antigravity",
	cursor: "Cursor",
	kimi: "Kimi",
	"kimi-coding": "Kimi",
	xai: "xAI",
};

export function labelForWindow(secs: number | undefined): string {
	if (!secs) return "now";
	const h = secs / 3600;
	if (h <= 1) return `${Math.round(secs / 60)}m`;
	if (h < 24) return `${Math.round(h)}h`;
	const d = h / 24;
	if (d >= 28 && d <= 31) return "mo";
	return `${Math.round(d)}d`;
}
