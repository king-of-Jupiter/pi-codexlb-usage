/**
 * pi / oh-my-pi extension: usage limit bars from a codex-lb load balancer.
 * Works on both hosts. Uses only structural types so it needs no host package at compile time.
 *
 * Data: polls the balancer's usage endpoint (`limits[]` with 5h/7d credit windows)
 * over HTTPS with a Bearer token (see `sources/codexlb.ts`).
 */
import { renderLine, type BarMode } from "./render.ts";
import { MUTED, PASTEL, VIVID, type Palette } from "./smart-color.ts";
import { maskToken, resolveConfig, saveFileConfig } from "./config.ts";
import { endpointHost, fetchCodexLbUsage, isConfigurableUrl, normalizeEndpointUrl, pollIntervalMs } from "./sources/codexlb.ts";
import { SubscriptionStore } from "./store.ts";

// ---- minimal host surface (pi and omp both satisfy this) ----
interface HostCtx {
	model?: { provider?: string; id?: string };
	hasUI?: boolean;
	ui: {
		setWidget: (key: string, lines: string[] | undefined, o?: { placement?: "aboveEditor" | "belowEditor" }) => void;
		notify: (msg: string, level?: "info" | "warning" | "error") => void;
	};
	setInterval?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (h: unknown) => void;
}
interface CompletionItem {
	value: string;
	label: string;
	description?: string;
}
interface HostAPI {
	on: (event: string, handler: (event: any, ctx: HostCtx) => unknown) => void;
	registerCommand: (name: string, def: { description: string; getArgumentCompletions?: (argumentPrefix: string) => CompletionItem[] | null; handler: (args: string, ctx: HostCtx) => Promise<void> | void }) => void;
}

const WIDGET = "usage-limits";
const TICK_MS = 60_000; // re-render so reset countdowns move
const PALETTES: Record<string, Palette> = { muted: MUTED, vivid: VIVID, pastel: PASTEL };
const PALETTE_NAMES = ["muted", "vivid", "pastel"];
const SUBCOMMANDS: CompletionItem[] = [
	{ value: "toggle", label: "toggle", description: "Hide / show the widget" },
	{ value: "palette", label: "palette", description: "Switch colors: muted, vivid, pastel" },
	{ value: "mode", label: "mode", description: "Show used or remaining share" },
	{ value: "status", label: "status", description: "Endpoint, poll age, error — no secrets" },
	{ value: "config", label: "config", description: "Config file and field sources" },
	{ value: "set-url", label: "set-url", description: "Save the balancer endpoint URL" },
	{ value: "set-token", label: "set-token", description: "Save the bearer token" },
];

/** Tab-completion for `/limits` args: subcommands first, option values after `palette `/`mode `. */
export function getLimitsCompletions(argumentPrefix: string): CompletionItem[] | null {
	const [first = "", ...rest] = argumentPrefix.split(/\s+/);
	if (rest.length > 0) {
		const partial = rest.join(" ");
		if (first === "palette") {
			return PALETTE_NAMES.filter((n) => n.startsWith(partial)).map((n) => ({ value: n, label: n }));
		}
		if (first === "mode") {
			return (["used", "remaining"] as const).filter((n) => n.startsWith(partial)).map((n) => ({ value: n, label: n }));
		}
		return null; // free-text args (set-url, set-token): nothing to suggest
	}
	return SUBCOMMANDS.filter((s) => s.value.startsWith(first));
}

function normalizeMode(v: string | undefined): BarMode {
	return v?.trim() === "remaining" ? "remaining" : "used";
}

export default function codexlbUsage(pi: HostAPI): void {
	const store = new SubscriptionStore();
	let visible = process.env.USAGE_LIMITS_HIDDEN !== "1";
	let palette = PALETTES[process.env.USAGE_LIMITS_PALETTE ?? ""] ?? MUTED;
	let mode = normalizeMode(process.env.CODEXLB_MODE ?? process.env.USAGE_LIMITS_MODE);
	let ctx: HostCtx | undefined;
	let timers: unknown[] = [];
	let lastError = "";
	let lastPollAt = 0;
	let hintShown = false;
	const now = () => Math.floor(Date.now() / 1000);
	const debug = (...a: unknown[]) => { if (process.env.USAGE_LIMITS_DEBUG ?? process.env.CODEXLB_DEBUG) console.error("[codexlb-usage]", ...a); };

	function render(): void {
		if (!ctx || ctx.hasUI === false) return;
		if (!visible || store.size === 0) return ctx.ui.setWidget(WIDGET, undefined);
		const t = now();
		const lines = store.all().map((s) => renderLine(s.name, s.windows, { now: t, palette, mode }));
		ctx.ui.setWidget(WIDGET, lines, { placement: "belowEditor" });
	}

	async function poll(): Promise<void> {
		if (!ctx) return;
		const t = now();
		const cfg = await resolveConfig();
		if (cfg.fileError) {
			lastError = cfg.fileError;
			debug("codexlb:", lastError);
			return render();
		}
		if (!cfg.url || !cfg.token) {
			lastError = "not configured — run /limits set-url <url> and /limits set-token <token> (or set CODEXLB_URL/CODEXLB_TOKEN)";
			debug("codexlb:", lastError);
			return render();
		}
		try {
			const r = await fetchCodexLbUsage(cfg.url, cfg.token, t, { label: cfg.label });
			lastPollAt = t;
			if (r.subscription) {
				store.upsert(r.subscription);
				lastError = "";
			} else {
				lastError = r.error ?? "unknown error";
			}
		} catch (e) {
			lastError = e instanceof Error ? e.message : String(e);
			debug("poll error:", lastError);
		}
		debug("subscriptions:", store.all().map((s) => `${s.name}[${s.source}] ${s.windows.map((w) => `${w.label}=${Math.round(w.used * 100)}%`).join(",")}`));
		render();
	}

	function startTimers(): void {
		stopTimers();
		const set = ctx?.setInterval ? (fn: () => void, ms: number) => ctx!.setInterval!(fn, ms) : (fn: () => void, ms: number) => {
			const h = setInterval(fn, ms);
			(h as any).unref?.();
			return h;
		};
		timers.push(set(() => void poll(), pollIntervalMs()), set(render, TICK_MS));
	}
	function stopTimers(): void {
		for (const h of timers) (ctx?.clearTimer ? ctx.clearTimer(h) : clearInterval(h as any));
		timers = [];
	}

	pi.on("session_start", async (_e, c) => {
		ctx = c;
		hintShown = false;
		startTimers();
		await poll();
		// One-time setup hint so a fresh install tells you what to do.
		if (!hintShown && ctx.hasUI !== false && store.size === 0) {
			const cfg = await resolveConfig();
			if (!cfg.url || !cfg.token) {
				hintShown = true;
				ctx.ui.notify("CodexLB usage: not configured — run /limits set-url <url> and /limits set-token <token> (or set CODEXLB_URL/CODEXLB_TOKEN)", "info");
			}
		}
	});
	pi.on("session_shutdown", () => stopTimers());

	pi.registerCommand("limits", {
		description: "CodexLB usage bars: /limits [refresh|toggle|palette muted|vivid|pastel|mode used|remaining|status|config|set-url <url>|set-token <token>]",
		getArgumentCompletions: getLimitsCompletions,
		handler: async (args, c) => {
			ctx = c;
			const [cmd, arg] = args.trim().split(/\s+/);
			const rest = args.slice(cmd.length).trim();
			if (cmd === "toggle") {
				visible = !visible;
				return render();
			}
			if (cmd === "palette") {
				if (PALETTES[arg]) {
					palette = PALETTES[arg];
					return render();
				}
				return c.ui.notify("limits: unknown palette — use muted, vivid or pastel", "warning");
			}
			if (cmd === "mode") {
				if (arg === "used" || arg === "remaining") {
					mode = arg;
					return render();
				}
				return c.ui.notify(`limits: unknown mode — use used or remaining (current: ${mode})`, "warning");
			}
			if (cmd === "set-url") {
				const normalized = normalizeEndpointUrl(arg ?? "");
				if (!isConfigurableUrl(normalized)) return c.ui.notify("limits: give the balancer host or full usage URL, e.g. /limits set-url codexlb.example.com or /limits set-url https://example.com/v1/usage", "warning");
				await saveFileConfig({ endpointUrl: normalized });
				hintShown = true;
				await poll();
				const subs = store.all();
				return c.ui.notify(
					subs.length ? `CodexLB: endpoint saved (${normalized}), ${subs.length} subscription(s) polled` : `CodexLB: endpoint saved (${normalized}) but poll failed: ${lastError}`,
					subs.length ? "info" : "warning",
				);
			}
			if (cmd === "set-token") {
				if (!rest) return c.ui.notify("limits: give a token, e.g. /limits set-token <token> (stored with mode 0600)", "warning");
				await saveFileConfig({ bearerToken: rest });
				hintShown = true;
				await poll();
				const subs = store.all();
				return c.ui.notify(
					subs.length ? `CodexLB: token saved, ${subs.length} subscription(s) polled` : `CodexLB: token saved but poll failed: ${lastError}`,
					subs.length ? "info" : "warning",
				);
			}
			if (cmd === "config") {
				const cfg = await resolveConfig();
				return c.ui.notify(
					[
						`config file: ${cfg.path}`,
						`endpoint: ${cfg.url ? `${normalizeEndpointUrl(cfg.url)} (${cfg.urlFrom})` : "(missing)"}`,
						`token: ${cfg.token ? `${maskToken(cfg.token)} (${cfg.tokenFrom})` : "(missing)"}`,
						`label: ${cfg.label} (${cfg.labelFrom})`,
						...(cfg.fileError ? [`file error: ${cfg.fileError}`] : []),
					].join("\n"),
					"info",
				);
			}
			if (cmd === "status") {
				const cfg = await resolveConfig();
				const subs = store.all();
				const shown = (u: number) => Math.round(((mode === "remaining" ? 1 - u : u)) * 100);
				const detail = subs.length
					? subs.map((s) => `${s.name}[${s.source}]: ${s.windows.map((w) => `${w.label}=${shown(w.used)}%`).join(", ")}`).join("; ")
					: "no data yet";
				return c.ui.notify(
					`codexlb: ${cfg.url ? endpointHost(cfg.url) : "(no url)"} as ${cfg.label}${lastPollAt ? `, polled ${Math.max(0, now() - lastPollAt)}s ago` : ", never polled"}${lastError ? `, last error: ${lastError}` : ""}\n${detail}`,
					"info",
				);
			}
			await poll();
			const subs = store.all();
			if (!subs.length) return c.ui.notify(lastError ? `limits: no data (${lastError})` : "limits: no data yet — run /limits set-url and /limits set-token", "warning");
			const t = now();
			c.ui.notify(subs.map((s) => `${renderLine(s.name, s.windows, { now: t, color: false, mode })}  [${s.source}]`).join("\n"), "info");
		},
	});
}
