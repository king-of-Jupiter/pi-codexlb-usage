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
	/** Where it came from: always "codexlb-api". */
	source: string;
}

export const PROVIDER_NAMES: Record<string, string> = {
	codexlb: "CodexLB",
};
