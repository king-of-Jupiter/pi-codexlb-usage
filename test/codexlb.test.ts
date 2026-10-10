import { test } from "node:test";
import assert from "node:assert/strict";
import {
	endpointHost,
	extractLimits,
	fetchCodexLbUsage,
	isConfigurableUrl,
	limitToWindow,
	normalizeEndpointUrl,
	normalizeLimit,
	parseCodexLbResponse,
	parseWindowSeconds,
	pollIntervalMs,
	subscriptionFromLimits,
	usedFraction,
} from "../src/sources/codexlb.ts";
import { resolveConfig } from "../src/config.ts";
import { renderLine, renderWindow } from "../src/render.ts";

const now = 1_700_000_000;

test("parseWindowSeconds: durations map to seconds, junk maps to null", () => {
	assert.equal(parseWindowSeconds("5h"), 18000);
	assert.equal(parseWindowSeconds("7d"), 604800);
	assert.equal(parseWindowSeconds(" 90m "), 5400);
	assert.equal(parseWindowSeconds("1w"), 604800);
	assert.equal(parseWindowSeconds("credits"), null);
	assert.equal(parseWindowSeconds(""), null);
	assert.equal(parseWindowSeconds("0h"), null);
});

test("normalizeLimit: coerces numeric strings, rejects entries without limit_window", () => {
	assert.deepEqual(normalizeLimit({ limit_window: "5h", max_value: "100", current_value: "42", reset_at: "2026-01-01T00:00:00Z" }), {
		limit_window: "5h",
		limit_type: null,
		max_value: 100,
		current_value: 42,
		remaining_value: null,
		model_filter: null,
		reset_at: "2026-01-01T00:00:00Z",
	});
	assert.equal(normalizeLimit({ max_value: 1 }), null);
	assert.equal(normalizeLimit(null), null);
	assert.equal(normalizeLimit({ limit_window: "5h", max_value: "junk", current_value: 1 })?.max_value, null);
});

test("extractLimits: limits[] wins, upstream_limits[] is the fallback", () => {
	const five = { limit_window: "5h", max_value: 100, current_value: 10 };
	const seven = { limit_window: "7d", max_value: 100, current_value: 20 };
	assert.equal(extractLimits({ limits: [five], upstream_limits: [seven] })?.length, 1);
	assert.equal(extractLimits({ limits: [five], upstream_limits: [seven] })?.[0].limit_window, "5h");
	assert.equal(extractLimits({ upstream_limits: [seven] })?.[0].limit_window, "7d");
	assert.deepEqual(extractLimits({ limits: [], upstream_limits: [] }), []);
	assert.equal(extractLimits({ nope: 1 }), null);
	assert.equal(extractLimits(null), null);
});

test("usedFraction: current/max first, max-remaining fallback, null when unusable", () => {
	assert.equal(usedFraction({ limit_window: "5h", max_value: 100, current_value: 42 }), 0.42);
	assert.equal(usedFraction({ limit_window: "5h", max_value: 100, remaining_value: 30 }), 0.7);
	assert.equal(usedFraction({ limit_window: "5h", current_value: 42 }), null);
	assert.equal(usedFraction({ limit_window: "5h", max_value: 0, current_value: 1 }), null);
});

test("limitToWindow: 5h/7d labels with resets, model_filter scopes the label", () => {
	const w = limitToWindow({ limit_window: "5h", max_value: 100, current_value: 42, reset_at: new Date((now + 3600) * 1000).toISOString() })!;
	assert.deepEqual([w.label, w.used, w.resetsAt, w.windowSecs], ["5h", 0.42, now + 3600, 18000]);
	const scoped = limitToWindow({ limit_window: "7d", max_value: 200, current_value: 22, model_filter: "Opus 4" })!;
	assert.equal(scoped.label, "7d·opus-4");
	assert.equal(scoped.resetsAt, undefined);
	assert.equal(scoped.windowSecs, 604800);
	// Bad reset_at degrades to a threshold gauge instead of failing.
	const gauge = limitToWindow({ limit_window: "5h", max_value: 100, current_value: 90, reset_at: "not-a-date" })!;
	assert.equal(gauge.resetsAt, undefined);
	// Non-duration windows keep the provider string verbatim.
	const credits = limitToWindow({ limit_window: "credits", max_value: 10, current_value: 2 })!;
	assert.equal(credits.label, "credits");
	assert.equal(limitToWindow({ limit_window: "5h", max_value: null, current_value: null }), null);
});

test("subscriptionFromLimits: dedups labels, undefined when nothing usable", () => {
	const s = subscriptionFromLimits([
		{ limit_window: "5h", max_value: 100, current_value: 10 },
		{ limit_window: "5h", max_value: 100, current_value: 20, model_filter: "x" },
		{ limit_window: "5h", max_value: 100, current_value: 20, model_filter: "x" },
		{ limit_window: "7d" },
	], now)!;
	assert.equal(s.provider, "codexlb");
	assert.equal(s.source, "codexlb-api");
	assert.deepEqual(s.windows.map((w) => w.label), ["5h", "5h·x", "5h·x_2"]);
	assert.equal(subscriptionFromLimits([{ limit_window: "7d" }], now), undefined);
	assert.equal(subscriptionFromLimits([], now), undefined);
});

test("parseCodexLbResponse: end-to-end payload → subscription", () => {
	const s = parseCodexLbResponse({
		request_count: 5,
		total_cost_usd: 1.2, // ignored: never displayed
		limits: [
			{ limit_window: "5h", max_value: 100, current_value: 42, reset_at: new Date((now + 3600) * 1000).toISOString() },
			{ limit_window: "7d", max_value: 1000, current_value: 110, reset_at: new Date((now + 86400) * 1000).toISOString() },
		],
	}, now)!;
	assert.equal(s.name, "CodexLB");
	assert.deepEqual(s.windows.map((w) => [w.label, w.used]), [["5h", 0.42], ["7d", 0.11]]);
	assert.equal(parseCodexLbResponse({ limits: [] }, now), undefined);
	assert.equal(parseCodexLbResponse({ garbage: true }, now), undefined);
});

test("codexlb renders as a plain line for /limits output", () => {
	const s = parseCodexLbResponse({ limits: [{ limit_window: "5h", max_value: 100, current_value: 42 }] }, now)!;
	const line = renderLine(s.name, s.windows, { color: false, now });
	assert.match(line, /CodexLB/);
	assert.match(line, /5h .*42%/);
	assert.doesNotMatch(line, /\x1b/);
});

test("render mode remaining flips bar and percent, risk color still derives from used", () => {
	const w = [{ label: "5h", used: 0.42 }];
	assert.equal(renderLine("CodexLB", w, { color: false, now }), "CodexLB  5h ████░░░░░░  42%");
	assert.equal(renderLine("CodexLB", w, { color: false, now, mode: "remaining" }), "CodexLB  5h █████░░░░░  58%");
	// Hot window stays hot in remaining mode (color is risk, not direction).
	const hot = { label: "5h", used: 0.92, resetsAt: now + 5400, windowSecs: 18000 };
	assert.match(renderWindow(hot, { now }), /38;2;207;107;107/);
	assert.match(renderWindow(hot, { now, mode: "remaining" }), /38;2;207;107;107/);
	assert.match(renderWindow(hot, { now, mode: "remaining", color: false }), /8%/);
});

// ---- fetch ----

function stubFetch(handler: (url: string, init: any) => unknown) {
	return (async (url: string, init: any) => handler(url, init)) as any;
}

test("normalizeEndpointUrl: bare hosts gain https:// + /v1/usage, full URLs kept", () => {
	assert.equal(normalizeEndpointUrl("codexlb.viperrr.ru"), "https://codexlb.viperrr.ru/v1/usage");
	assert.equal(normalizeEndpointUrl("https://codexlb.viperrr.ru"), "https://codexlb.viperrr.ru/v1/usage");
	assert.equal(normalizeEndpointUrl("http://127.0.0.1:2455/"), "http://127.0.0.1:2455/v1/usage");
	assert.equal(normalizeEndpointUrl("https://h/x/v1/usage"), "https://h/x/v1/usage");
	assert.equal(normalizeEndpointUrl("https://h/v1/usage/"), "https://h/v1/usage");
	assert.equal(normalizeEndpointUrl("https://codexlb.viperrr.ru/v1"), "https://codexlb.viperrr.ru/v1/usage");
	assert.equal(normalizeEndpointUrl("https://codexlb.viperrr.ru/v1/usage"), "https://codexlb.viperrr.ru/v1/usage");
	assert.equal(normalizeEndpointUrl("codexlb.viperrr.ru"), "https://codexlb.viperrr.ru/v1/usage");
	assert.equal(normalizeEndpointUrl("https://h/api"), "https://h/api/usage");
	assert.equal(normalizeEndpointUrl(""), "");
	assert.equal(isConfigurableUrl(normalizeEndpointUrl("codexlb.viperrr.ru")), true);
	assert.equal(isConfigurableUrl(normalizeEndpointUrl("http://localhost:2455")), true);
	assert.equal(isConfigurableUrl(normalizeEndpointUrl("notaurl")), false);
	assert.equal(isConfigurableUrl(normalizeEndpointUrl("ftp://h/x")), false);
});

test("fetch: sends Bearer token + Accept, maps 5h/7d", async () => {
	let seen: any = null;
	const fetchFn = stubFetch((url: string, init: any) => {
		seen = { url, init };
		return { status: 200, ok: true, json: async () => ({ limits: [{ limit_window: "5h", max_value: 100, current_value: 25 }] }) };
	});
	const r = await fetchCodexLbUsage("https://lb.example.com/api/usage", "tok-123", now, { fetchFn, label: "LB" });
	assert.equal(r.error, undefined);
	assert.equal(r.subscription?.name, "LB");
	assert.equal(r.subscription?.windows[0].label, "5h");
	assert.equal(seen.init.headers.Authorization, "Bearer tok-123");
	assert.equal(seen.init.headers.Accept, "application/json");
});

test("fetch: auth failures, http errors, bad json, bad shape, network errors", async () => {
	const ok = (json: unknown, status = 200) => stubFetch(async () => ({ status, ok: status >= 200 && status < 300, json: async () => json }));
	assert.match((await fetchCodexLbUsage("https://lb.example.com/y", "t", now, { fetchFn: ok({}, 401) })).error!, /rejected.*401/);
	assert.equal((await fetchCodexLbUsage("https://lb.example.com/y", "t", now, { fetchFn: ok({}, 401) })).authFailed, true);
	assert.match((await fetchCodexLbUsage("https://lb.example.com/y", "t", now, { fetchFn: ok({}, 500) })).error!, /HTTP 500/);
	assert.match((await fetchCodexLbUsage("https://lb.example.com/y", "t", now, { fetchFn: stubFetch(async () => ({ status: 200, ok: true, json: async () => { throw new Error("boom"); } })) })).error!, /invalid JSON/);
	assert.match((await fetchCodexLbUsage("https://lb.example.com/y", "t", now, { fetchFn: ok({ nope: 1 }) })).error!, /unexpected JSON/);
	assert.match((await fetchCodexLbUsage("https://lb.example.com/y", "t", now, { fetchFn: ok({ limits: [] }) })).error!, /no limits/);
	assert.match((await fetchCodexLbUsage("https://lb.example.com/y", "t", now, { fetchFn: stubFetch(async () => { throw new Error("down"); }) })).error!, /request failed: down/);
});

test("fetch: missing config and non-http(s) urls fail fast without network", async () => {
	let called = false;
	const fetchFn = stubFetch(async () => { called = true; return { status: 200, ok: true, json: async () => ({}) }; });
	assert.match((await fetchCodexLbUsage("", "t", now, { fetchFn })).error!, /not configured/);
	assert.match((await fetchCodexLbUsage("https://lb.example.com/y", "", now, { fetchFn })).error!, /token/);
	assert.match((await fetchCodexLbUsage("notaurl", "t", now, { fetchFn })).error!, /http\(s\)/);
	assert.equal(called, false);
});

test("env config: aliases, poll clamp, host never leaks credentials", async () => {
	const viaAlias = await resolveConfig({ CODEXLB_USAGE_URL: "https://a/b", CODEXLB_BEARER_TOKEN: "t", CODEXLB_LABEL: "My LB" });
	assert.deepEqual([viaAlias.url, viaAlias.token, viaAlias.label], ["https://a/b", "t", "My LB"]);
	assert.deepEqual([viaAlias.urlFrom, viaAlias.tokenFrom], ["env", "env"]);
	assert.equal(pollIntervalMs({}, 300_000), 300_000);
	assert.equal(pollIntervalMs({ CODEXLB_POLL_MS: "60000" }), 60_000);
	assert.equal(pollIntervalMs({ CODEXLB_POLL_MS: "1000" }), 60_000); // floor: usage endpoints are rate limited
	assert.equal(pollIntervalMs({ CODEXLB_POLL_MS: "junk" }), 300_000);
	assert.equal(endpointHost("https://lb.example.com:8443/api/usage"), "lb.example.com:8443");
	assert.equal(endpointHost("notaurl"), "(invalid url)");
});

test("fetch: bare host is normalized to https:// + /v1/usage before the request", async () => {
	let seenUrl = "";
	const fetchFn = (async (url: string, init: any) => {
		seenUrl = url;
		return { status: 200, ok: true, json: async () => ({ limits: [{ limit_window: "5h", max_value: 100, current_value: 25 }] }) };
	}) as any;
	const r = await fetchCodexLbUsage("codexlb.viperrr.ru", "t", now, { fetchFn });
	assert.equal(r.error, undefined);
	assert.equal(seenUrl, "https://codexlb.viperrr.ru/v1/usage");
	assert.equal(r.subscription?.windows[0].label, "5h");
});
