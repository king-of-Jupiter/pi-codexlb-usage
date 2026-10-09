import type { Subscription } from "../types.ts";
import { PROVIDER_NAMES, labelForWindow } from "../types.ts";

const num = (v: string | undefined) => {
	if (v === undefined || v === "") return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
};
const toSecs = (t: number | undefined) => (t === undefined ? undefined : t > 1e12 ? Math.round(t / 1000) : Math.round(t));

/** Anthropic: anthropic-ratelimit-unified-{5h,7d}-{utilization,reset}. utilization is 0..1, reset is epoch seconds. */
export function parseAnthropicHeaders(h: Record<string, string>, now: number): Subscription | undefined {
	const windows: Subscription["windows"] = [];
	for (const [key, label, secs] of [
		["5h", "5h", 5 * 3600],
		["7d", "7d", 7 * 86400],
	] as const) {
		const u = num(h[`anthropic-ratelimit-unified-${key}-utilization`]);
		const r = num(h[`anthropic-ratelimit-unified-${key}-reset`]);
		if (u === undefined && r === undefined) continue;
		windows.push({ label, used: u ?? 0, resetsAt: toSecs(r), windowSecs: secs });
	}
	if (!windows.length) return undefined;
	return { provider: "anthropic", name: PROVIDER_NAMES.anthropic, windows, updatedAt: now, source: "headers" };
}

/** OpenAI Codex: x-codex-{primary,secondary}-{used-percent,window-minutes,reset-at}. */
export function parseCodexHeaders(h: Record<string, string>, now: number): Subscription | undefined {
	const windows: Subscription["windows"] = [];
	for (const [key, dflt] of [
		["primary", 5 * 3600],
		["secondary", 7 * 86400],
	] as const) {
		const pct = num(h[`x-codex-${key}-used-percent`]);
		if (pct === undefined) continue;
		const mins = num(h[`x-codex-${key}-window-minutes`]);
		const secs = mins !== undefined ? mins * 60 : dflt;
		windows.push({ label: labelForWindow(secs), used: pct / 100, resetsAt: toSecs(num(h[`x-codex-${key}-reset-at`])), windowSecs: secs });
	}
	if (!windows.length) return undefined;
	return { provider: "openai-codex", name: PROVIDER_NAMES["openai-codex"], windows, updatedAt: now, source: "headers" };
}

export function parseHeaders(provider: string | undefined, headers: Record<string, string>, now: number): Subscription | undefined {
	// Try by provider first, then sniff — some hosts do not tell us the provider.
	if (provider === "anthropic") return parseAnthropicHeaders(headers, now);
	if (provider === "openai-codex") return parseCodexHeaders(headers, now);
	return parseAnthropicHeaders(headers, now) ?? parseCodexHeaders(headers, now);
}
